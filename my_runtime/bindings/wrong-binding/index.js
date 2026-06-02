"use strict";

class InvalidClientFactory {
    constructor() {
        this.scheme = "wrong";
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
        id: "wrong-binding",
        createClientFactory() {
            // Intentionally invalid: the runtime requires ClientFactories to provide getClient().
            return new InvalidClientFactory();
        }
    };
}

module.exports = {
    createBinding
};
