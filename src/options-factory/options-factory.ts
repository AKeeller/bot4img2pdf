import TelegramBot from "node-telegram-bot-api";

interface OptionsFactory {
	createOptions(): TelegramBot.ConstructorOptions;
}

export default OptionsFactory