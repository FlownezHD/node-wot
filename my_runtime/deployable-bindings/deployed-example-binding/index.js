"use strict";

class DeployedExampleClientFactory {
    constructor() {
        this.scheme = "deployed-example";
    }

    getClient() {
        return {};
    }

    init() {
        return true;
    }

    destroy() {
        return true;
    }
}

function createBinding() {
    return {
        id: "deployed-example-binding",
        createClientFactory: () => new DeployedExampleClientFactory(),
    };
}

module.exports = {
    createBinding,
};
