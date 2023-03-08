import TelegramBot from "node-telegram-bot-api";
import OptionsFactory from "./options-factory";

class PollingOptionsFactory implements OptionsFactory {
	createOptions(): TelegramBot.ConstructorOptions {
		return { polling: true }
	}
}

export default PollingOptionsFactory