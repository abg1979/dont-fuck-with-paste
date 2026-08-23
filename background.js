import DFWP from './dfwp.js';
import { BackgroundController } from './background-controller.mjs';

const controller = new BackgroundController(DFWP.browser, DFWP.storage);
controller.register();
