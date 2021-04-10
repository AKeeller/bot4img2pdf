import TelegramBot from "node-telegram-bot-api"

const token = process.env.TOKEN

if (!token)
	throw new Error("Token not found. Create a .env file an put your token there.")

let options

if (!process.env.CERT || !process.env.KEY)
	options = { polling: true }
else
	options = { webHook: { cert: process.env.CERT, key: process.env.KEY } }

export const bot = new TelegramBot(token, options)