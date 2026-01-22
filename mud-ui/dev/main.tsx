import "../src/cockpit/index"; // registers window.spawnMudOverlay

// Auto-spawn on load
window.spawnMudOverlay?.("ws://localhost:8080", { deferConnect: false });