import TelegramBot from "node-telegram-bot-api";
import { State } from "./state/state";
import { StartState } from "./state/state.start";

const token = process.env.TOKEN

if (!token)
	throw new Error("Token not found. Create a .env file an put your token there.")

const bot = new TelegramBot(token, {polling: true})

// Chat ID -- State
const chats = new Map<number, State>()

bot.on('message', (msg) => {
	const username = msg.chat.username
	const chatId = msg.chat.id

	const state: State = chats.get(chatId) ?? new StartState()
	const next = state.next()
	const reply: string = state.reply()

	next ? chats.set(chatId, next) : chats.delete(chatId)

	bot.sendMessage(chatId, reply)
	console.log(username + ": " + msg.text)
	console.log("Bot: " + reply)
})