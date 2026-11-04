import { afterAll } from "bun:test";
import { runCleanups } from "./cleanup";

afterAll(runCleanups);
