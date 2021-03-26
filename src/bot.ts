import TelegramBot from "node-telegram-bot-api"

export class Bot {

	private _bot: TelegramBot
	private static _instance: Bot

	private constructor() {
		const token = process.env.TOKEN

		if (!token)
			throw new Error("Token not found. Create a .env file an put your token there.")

		let options

		if(!process.env.CERT || !process.env.KEY)
			options = { polling: true }
		else
			options = { webHook: { cert: process.env.CERT, key: process.env.KEY } }

		this._bot = new TelegramBot(token, options)
	}

	public static get instance() {
		if (!Bot._instance)
			Bot._instance = new Bot()
		return Bot._instance
	}

	public get bot() {
		return this._bot
	}
}