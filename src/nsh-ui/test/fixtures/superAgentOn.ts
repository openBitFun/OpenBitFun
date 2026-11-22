// Switches the Super Agent UI gate on (`src/productGates.ts`) for the suites
// that cover that surface. Import it before anything from `src/`, so modules
// that read the gate when they load (the landing scene, Settings) see it on.
import { superAgentUi } from "../../src/productGates";

superAgentUi.set(true);
