import TelegramBot from "node-telegram-bot-api"
import postSetupRoutine from "./bot-post-setup"
import PollingOptionsFactory from "./options-factory/polling-options-factory"
import WebhookOptionsFactory from "./options-factory/webhook-options-factory"

const token = process.env.TOKEN

if (!token)
	throw new Error("Token not found. Create a .env file an put your token there.")

const factory = process.env.WEBHOOK_URL ? new WebhookOptionsFactory() : new PollingOptionsFactory()
const options = factory.createOptions()

const bot = new TelegramBot(token, options)

postSetupRoutine(bot)

console.log("Bot started.")

export default bot;