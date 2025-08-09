import TelegramBot from "node-telegram-bot-api";
import bot from "./bot";
import State from "./state/state";
import { StartState } from "./state/state.start";

// Enable automatic resolve of filename and contentType for file attachments
process.env.NTBA_FIX_350 = '1';

const chats = new Map<TelegramBot.Message['chat']['id'], State>()

bot.on('message', async (msg) => {
	const chatId = msg.chat.id

	const state = chats.get(chatId) ?? new StartState()
	const next = await state.next(msg)

	next ? chats.set(chatId, next) : chats.delete(chatId)
})