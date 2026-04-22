"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var runtimeStatus = "running";
var lastOperation = "Runtime initialized";
var registeredBindings = [];
WoT.produce({
    title: "Runtime",
    description: "WoT runtime to manage protocol bindings.",
    properties: {
        status: {
            type: "string",
            description: "Current runtime status",
            observable: true,
            readOnly: true,
        },
        lastOperation: {
            type: "string",
            description: "Description of the last runtime operation",
            observable: true,
            readOnly: true,
        },
        registeredBindings: {
            type: "array",
            description: "Bindings currently known to the runtime",
            observable: true,
            readOnly: true,
            items: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                    },
                    protocol: {
                        type: "string",
                    },
                    package: {
                        type: "string",
                    },
                },
            },
        },
    },
    actions: {
        addBinding: {
            description: "Add a binding entry to the runtime",
            input: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                    },
                    protocol: {
                        type: "string",
                    },
                    package: {
                        type: "string",
                    },
                },
                required: ["id"],
            },
            output: {
                type: "object",
                properties: {
                    result: {
                        type: "boolean",
                    },
                    message: {
                        type: "string",
                    },
                },
            },
        },
        removeBinding: {
            description: "Remove a binding entry from the runtime skeleton",
            input: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                    },
                },
                required: ["id"],
            },
            output: {
                type: "object",
                properties: {
                    result: {
                        type: "boolean",
                    },
                    message: {
                        type: "string",
                    },
                },
            },
        },
    },
    events: {
        bindingAdded: {
            description: "Emitted when a binding was added to the runtime skeleton",
        },
        bindingRemoved: {
            description: "Emitted when a binding was removed from the runtime skeleton",
        },
    },
})
    .then(function (thing) {
    console.log("Produced ".concat(thing.getThingDescription().title));
    thing.setPropertyReadHandler("status", function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
        return [2 /*return*/, runtimeStatus];
    }); }); });
    thing.setPropertyReadHandler("lastOperation", function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
        return [2 /*return*/, lastOperation];
    }); }); });
    thing.setPropertyReadHandler("registeredBindings", function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
        return [2 /*return*/, registeredBindings];
    }); }); });
    thing.setActionHandler("addBinding", function (params) { return __awaiter(void 0, void 0, void 0, function () {
        var input, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!(params == null)) return [3 /*break*/, 1];
                    _a = undefined;
                    return [3 /*break*/, 3];
                case 1: return [4 /*yield*/, params.value()];
                case 2:
                    _a = (_b.sent());
                    _b.label = 3;
                case 3:
                    input = _a;
                    if (typeof (input === null || input === void 0 ? void 0 : input.id) !== "string" || input.id.length === 0) {
                        return [2 /*return*/, { result: false, message: "Binding id is required." }];
                    }
                    // TODO: Replace this placeholder with validation and dynamic loading logic.
                    registeredBindings.push({
                        id: input.id,
                        protocol: input.protocol,
                        package: input.package,
                    });
                    lastOperation = "Added binding '".concat(input.id, "'");
                    thing.emitPropertyChange("registeredBindings");
                    thing.emitPropertyChange("lastOperation");
                    thing.emitEvent("bindingAdded", { id: input.id });
                    return [2 /*return*/, { result: true, message: "Binding '".concat(input.id, "' added to runtime skeleton.") }];
            }
        });
    }); });
    thing.setActionHandler("removeBinding", function (params) { return __awaiter(void 0, void 0, void 0, function () {
        var input, _a, nextBindings;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!(params == null)) return [3 /*break*/, 1];
                    _a = undefined;
                    return [3 /*break*/, 3];
                case 1: return [4 /*yield*/, params.value()];
                case 2:
                    _a = (_b.sent());
                    _b.label = 3;
                case 3:
                    input = _a;
                    if (typeof (input === null || input === void 0 ? void 0 : input.id) !== "string" || input.id.length === 0) {
                        return [2 /*return*/, { result: false, message: "Binding id is required." }];
                    }
                    nextBindings = registeredBindings.filter(function (binding) { return binding.id !== input.id; });
                    if (nextBindings.length === registeredBindings.length) {
                        return [2 /*return*/, { result: false, message: "Binding '".concat(input.id, "' was not found.") }];
                    }
                    registeredBindings = nextBindings;
                    lastOperation = "Removed binding '".concat(input.id, "'");
                    thing.emitPropertyChange("registeredBindings");
                    thing.emitPropertyChange("lastOperation");
                    thing.emitEvent("bindingRemoved", { id: input.id });
                    return [2 /*return*/, { result: true, message: "Binding '".concat(input.id, "' removed from runtime skeleton.") }];
            }
        });
    }); });
    thing.expose().then(function () {
        console.info("".concat(thing.getThingDescription().title, " ready"));
    });
})
    .catch(function (err) {
    console.error(err);
});
