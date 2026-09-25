import { mkdirSync, cpSync } from "node:fs";
mkdirSync("dist", { recursive: true }); cpSync("src", "dist", { recursive: true }); console.log("build: dist/ written");
