"use strict";

class ExampleClient {
    async readResource() {
        throw new Error("ExampleClient.readResource() not implemented.");
    }

    async writeResource() {
        throw new Error("ExampleClient.writeResource() not implemented.");
    }

    async invokeResource() {
        throw new Error("ExampleClient.invokeResource() not implemented.");
    }

    async unlinkResource() {
        throw new Error("ExampleClient.unlinkResource() not implemented.");
    }

    async subscribeResource() {
        throw new Error("ExampleClient.subscribeResource() not implemented.");
    }

    async requestThingDescription() {
        throw new Error("ExampleClient.requestThingDescription() not implemented.");
    }

    async start() {}

    async stop() {}

    setSecurity() {
        return true;
    }
}

class ExampleClientFactory {
    constructor() {
        this.scheme = "example";
    }

    getClient() {
        return new ExampleClient();
    }

    init() {
        return true;
    }

    destroy() {
        return true;
    }
}

class ExampleServer {
    constructor() {
        this.scheme = "example";
    }

    async expose() {}

    async destroy() {
        return false;
    }

    async start() {}

    async stop() {}

    getPort() {
        return -1;
    }
}

function createBinding() {
    return {
        id: "example-binding",
        schemes: ["example"],
        createClientFactory() {
            return new ExampleClientFactory();
        },
        createServer() {
            return new ExampleServer();
        }
    };
}

module.exports = {
    createBinding
};
