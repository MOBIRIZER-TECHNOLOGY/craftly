/** Entry of the module worker that `client.ts` starts. All of the logic is in `engine.ts` and `workerHost.ts`. */
import { loadOrt } from "./ortRuntime";
import { bootWorker, type WorkerScope } from "./workerHost";

bootWorker(self as unknown as WorkerScope, loadOrt);
