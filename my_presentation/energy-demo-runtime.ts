type DemoDevice = {
    tdUri: string;
    propertyName: string;
};

type DeviceReadResult = {
    result: boolean;
    title?: string;
    propertyName?: string;
    value?: WoT.InteractionInput;
    message?: string;
};

const devices: Record<"battery" | "oldMeter" | "newMeter", DemoDevice> = {
    battery: {
        tdUri: process.env.BATTERY_TD ?? "coap://localhost:5686/.well-known/wot-thing-description",
        propertyName: "stateOfCharge",
    },
    oldMeter: {
        tdUri: process.env.OLD_METER_TD ?? "coap://localhost:5687/.well-known/wot-thing-description",
        propertyName: "reading",
    },
    newMeter: {
        tdUri: process.env.NEW_METER_TD ?? "new://localhost:9103/new-electricity-meter-01",
        propertyName: "reading",
    },
};

async function readDeviceProperty(device: DemoDevice): Promise<DeviceReadResult> {
    try {
        const thingDescription = await WoT.requestThingDescription(device.tdUri);
        const consumedThing = await WoT.consume(thingDescription);
        const output = await consumedThing.readProperty(device.propertyName);

        return {
            result: true,
            title: thingDescription.title,
            propertyName: device.propertyName,
            value: (await output.value()) as WoT.InteractionInput,
        };
    } catch (error) {
        return {
            result: false,
            propertyName: device.propertyName,
            message: error instanceof Error ? error.message : `Failed to read '${device.propertyName}'.`,
        };
    }
}

async function main() {
    const thing = await WoT.produce({
        title: "EnergyDemoApplication",
        id: "urn:poc:energy-demo-application",
        description: "Presentation application that consumes demo devices through the shared node-wot Servient.",
        properties: {
            batteryStateOfCharge: {
                type: "number",
                readOnly: true,
                description: "Battery state of charge read through standard CoAP.",
            },
            oldMeterReading: {
                type: "object",
                readOnly: true,
                description: "Legacy meter reading read through standard CoAP.",
            },
            newMeterReading: {
                type: "object",
                readOnly: true,
                description: "Replacement meter reading read through new-binding after it was loaded dynamically.",
            },
            deviceTargets: {
                type: "object",
                readOnly: true,
                description: "Configured demo device Thing Description targets.",
            },
        },
        actions: {
            readBattery: {
                description: "Read the battery storage through the shared Servient.",
                output: {
                    type: "object",
                },
            },
            readOldMeter: {
                description: "Read the old electricity meter through the shared Servient.",
                output: {
                    type: "object",
                },
            },
            readNewMeter: {
                description: "Read the replacement meter through the shared Servient.",
                output: {
                    type: "object",
                },
            },
            readAllDevices: {
                description: "Read all demo devices and return per-device results.",
                output: {
                    type: "object",
                },
            },
        },
    });

    thing.setPropertyReadHandler("batteryStateOfCharge", async () => {
        const result = await readDeviceProperty(devices.battery);

        if (result.result !== true) {
            throw new Error(result.message);
        }

        return result.value as WoT.InteractionInput;
    });

    thing.setPropertyReadHandler("oldMeterReading", async () => {
        const result = await readDeviceProperty(devices.oldMeter);

        if (result.result !== true) {
            throw new Error(result.message);
        }

        return result.value as WoT.InteractionInput;
    });

    thing.setPropertyReadHandler("newMeterReading", async () => {
        const result = await readDeviceProperty(devices.newMeter);

        if (result.result !== true) {
            throw new Error(result.message);
        }

        return result.value as WoT.InteractionInput;
    });

    thing.setPropertyReadHandler("deviceTargets", async () => devices);

    thing.setActionHandler("readBattery", async () => readDeviceProperty(devices.battery));
    thing.setActionHandler("readOldMeter", async () => readDeviceProperty(devices.oldMeter));
    thing.setActionHandler("readNewMeter", async () => readDeviceProperty(devices.newMeter));
    thing.setActionHandler("readAllDevices", async () => ({
        battery: await readDeviceProperty(devices.battery),
        oldMeter: await readDeviceProperty(devices.oldMeter),
        newMeter: await readDeviceProperty(devices.newMeter),
    }));

    await thing.expose();
    console.info(`${thing.getThingDescription().title} ready`);
}

void main().catch((error: unknown) => {
    console.error(error);
});
