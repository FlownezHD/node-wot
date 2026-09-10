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

function deployBinding() {
    return {
        id: "wrong-binding",
        createClientFactory() {
            // Intentionally invalid: the runtime requires ClientFactories to provide getClient().
            return new InvalidClientFactory();
        }
    };
}

module.exports = {
    deployBinding
};
