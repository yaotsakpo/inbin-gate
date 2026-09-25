import express from "express";
import { computeTotal } from "./orders.js";
const app = express();
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.post("/orders/total", (req, res) => res.json({ total: computeTotal(req.body.items || []) }));
if (process.env.NODE_ENV !== "test") app.listen(3000, () => console.log("orders api on 3000"));
export default app;
