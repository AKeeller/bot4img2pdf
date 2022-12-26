import TelegramBot from "node-telegram-bot-api";
import bot from "./bot";
import State from "./state/state";
import { StartState } from "./state/state.start";

const chats = new Map<TelegramBot.Message['chat']['id'], State>()

bot.on('message', (msg) => {
	const chatId = msg.chat.id

	const state = chats.get(chatId) ?? new StartState()
	const next = state.next(msg)

	next ? chats.set(chatId, next) : chats.delete(chatId)
})