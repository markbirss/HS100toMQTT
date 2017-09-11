const Mqtt = require('mqtt');
const Hs100Api = require('hs100-api');
const log = require('yalm');

const pkg = require('./package.json');
const config = require('yargs')
    .env('HS100toMQTT')
    .usage(pkg.name + ' ' + pkg.version + '\n' + pkg.description + '\n\nUsage: $0 [options]')
    .describe('verbosity', 'possible values: "error", "warn", "info", "debug"')
    .describe('name', 'instance name. used as mqtt client id and as prefix for connected topic')
    .describe('mqtt-url', 'mqtt broker url. See https://github.com/mqttjs/MQTT.js#connect-using-a-url')
    .describe('mqtt-username', 'mqtt broker username')
    .describe('mqtt-password', 'mqtt broker password')
    .describe('mqtt-retain', 'allow/disallow retain flag for mqtt messages')
    .alias({
        h: 'help',
        m: 'mqtt-url',
        v: 'verbosity'
    })
    .boolean('mqtt-retain')
    .default({
        name: 'hs100',
        'mqtt-url': 'mqtt://127.0.0.1',
        'mqtt-retain': true
    })
    .version()
    .help('help')
    .argv;

log.setLevel(config.verbosity);
log.info(pkg.name + ' ' + pkg.version + ' starting');
log.debug("loaded config: ", config);

log.info('mqtt trying to connect', config.mqttUrl);
const mqtt = Mqtt.connect(config.mqttUrl, {
    clientId: config.name + '_' + Math.random().toString(16).substr(2, 8),
    will: {topic: config.name + '/connected', payload: '0', retain: (config.mqttRetain)},
    username: config.mqttUsername,
    password: config.mqttPassword
});
mqtt.on('connect', () => {
    mqttConnected = true;

    log.info('mqtt connected', config.mqttUrl);
    mqtt.publish(config.name + '/connected', '1', {retain: (config.mqttRetain)});

    log.info('mqtt subscribe', config.name + '/set/#');
    mqtt.subscribe(config.name + '/set/#');
});
mqtt.on('close', () => {
    if (mqttConnected) {
        mqttConnected = false;
        log.error('mqtt closed ' + config.mqttUrl);
    }
});
mqtt.on('error', err => {
    log.error('mqtt', err);
});
mqtt.on('close', () => {
    log.warn('mqtt close');
});
mqtt.on('offline', () => {
    log.warn('mqtt offline');
});
mqtt.on('reconnect', () => {
    log.info('mqtt reconnect');
});

function mqttPublish(topic, payload, options = {retain: (config.mqttRetain)}) {
    if (typeof payload === 'object') {
        payload = JSON.stringify(payload);
    } else if (payload) {
        payload = String(payload);
    } else {
        payload = '';
    }
    mqtt.publish(topic, payload, options, err => {
        if (err) {
            log.error('mqtt publish', err);
        } else {
            log.debug('mqtt >', topic, payload);
        }
    });
}
mqtt.on('message', (topic, payload) => {
    payload = payload.toString();
    log.debug('mqtt <', topic, payload);

    if (payload.indexOf('{') !== -1) {
        try {
            payload = JSON.parse(payload);
            payload = payload["val"];
        } catch (err) {
            log.error(err.toString());
        }
    } else if (payload === 'false') {
        payload = false;
    } else if (payload === 'true') {
        payload = true;
    } else if (!isNaN(payload)) {
        payload = parseFloat(payload);
    }
    const [, method, id, datapoint] = topic.split('/');

    log.debug("mqtt < ", method, id, datapoint);

    switch (method) {
        case 'set':
            if (datapoint == "poweron") {
                if (client.devices.has(id)) {
                    const device = client.devices.get(id);

                    device.setPowerState(payload);
                }
            }
            break;

        default:
            log.error('unknown method', method);
    }
});


const client = new Hs100Api.Client();
client.on('device-new', (device) => {
    log.info('hs100 device-new', device.model, device.host, device.deviceId, device.name);
    mqttPublish(config.name + "/status/" + device.deviceId + "/online", "true");

    device.startPolling(1000);

    device.on('power-on', (device) => { 
        log.debug('hs100 power-on', device.name);
        mqttPublish(config.name + "/status/" + device.deviceId + "/poweron", "true");
    });
    device.on('power-off', (device) => { 
        log.debug('hs100 power-off', device.name);
        mqttPublish(config.name + "/status/" + device.deviceId + "/poweron", "false");
    });
});
client.on('device-online', (device) => { 
    log.debug('hs100 device-online', device.name);
    mqttPublish(config.name + "/status/" + device.deviceId + "/online", "true");
});
client.on('device-offline', (device) => { 
    log.warn('hs100 device-offline', device.name);
    mqttPublish(config.name + "/status/" + device.deviceId + "/online", "false");
});

log.info('Starting Device Discovery');
client.startDiscovery();
