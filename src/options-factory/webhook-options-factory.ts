import TelegramBot from "node-telegram-bot-api";
import OptionsFactory from "./options-factory";

class WebhookOptionsFactory implements OptionsFactory {
	createOptions(): TelegramBot.ConstructorOptions {
		if (process.env.CERT && process.env.KEY)
			return { webHook: { cert: process.env.CERT, key: process.env.KEY } }

		return { webHook: true }
	}
}

export default WebhookOptionsFactory