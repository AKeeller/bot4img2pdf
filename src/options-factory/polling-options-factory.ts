import type { TelegramBotOptions } from "node-telegram-bot-api";
import OptionsFactory from "./options-factory";

class PollingOptionsFactory implements OptionsFactory {
	createOptions(): TelegramBotOptions {
		return { polling: true }
	}
}

export default PollingOptionsFactory