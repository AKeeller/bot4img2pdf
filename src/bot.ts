import TelegramBot from "node-telegram-bot-api"
import PollingOptionsFactory from "./options-factory/polling-options-factory"
import WebhookOptionsFactory from "./options-factory/webhook-options-factory"

const token = process.env.TOKEN

if (!token)
	throw new Error("Token not found. Create a .env file an put your token there.")

const factory = process.env.WEBHOOK_URL ? new WebhookOptionsFactory() : new PollingOptionsFactory()
const options = factory.createOptions()

const bot = new TelegramBot(token, options)

if (process.env.WEBHOOK_URL) {
	const url = `${process.env.WEBHOOK_URL}/bot${process.env.TOKEN}`
	const options = { certificate: process.env.CERT }

	bot.setWebHook(url, options)
		.then(_ => console.log(`WebHook set to ${process.env.WEBHOOK_URL}`))
		.catch(reason => setTimeout(() => { throw new Error(`${reason}`) }))
}

export default bot;