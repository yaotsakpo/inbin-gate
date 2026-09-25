const target = (process.argv.find((a) => a.startsWith("--target=")) || "--target=none").split("=")[1];
if (!["staging", "prod"].includes(target)) { console.error(`deploy: unknown target ${target}`); process.exit(2); }
console.log(`deploy: would deploy dist/ to ${target} (dry run)`);
