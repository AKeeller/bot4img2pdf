import { Bot } from "./bot";
import { State } from "./state/state";
import { StartState } from "./state/state.start";

const bot = Bot.instance.bot

// Chat ID -- State
const chats = new Map<number, State>()

bot.on('message', (msg) => {
	const chatId = msg.chat.id

	const state: State = chats.get(chatId) ?? new StartState()
	const next = state.next(msg)

	next ? chats.set(chatId, next) : chats.delete(chatId)
})