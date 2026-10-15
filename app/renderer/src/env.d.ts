/// <reference types="vite/client" />
import type { Bridge } from "../../shared/api.js";

declare global {
    interface Window {
        api: Bridge;
    }
}
