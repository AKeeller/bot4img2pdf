import type { TelegramBotOptions } from "node-telegram-bot-api";

interface OptionsFactory {
	createOptions(): TelegramBotOptions;
}

export default OptionsFactory