import TelegramBot from "node-telegram-bot-api";
import { bot } from "./bot";
import { State } from "./state/state";
import { StartState } from "./state/state.start";

// Chat ID -- State
const chats = new Map<TelegramBot.Message['chat']['id'], State>()

bot.on('message', (msg) => {
	const chatId = msg.chat.id

	const state: State = chats.get(chatId) ?? new StartState()
	const next = state.next(msg)

	next ? chats.set(chatId, next) : chats.delete(chatId)
})