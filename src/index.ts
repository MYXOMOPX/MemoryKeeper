import { loadConfig } from './config.js';
import { createBot } from './bot/index.js';

const config = loadConfig();
const bot = createBot(config);
bot.start();
