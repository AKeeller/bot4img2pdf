import { type Message } from "node-telegram-bot-api";
import bot, { startBot } from "./bot";
import State from "./state/state";
import { StartState } from "./state/state.start";

const chats = new Map<Message['chat']['id'], State>()

bot.on('message', async (ctx) => {
	const msg = ctx.message
	if (!msg) return

	const chatId = msg.chat.id

	const state = chats.get(chatId) ?? new StartState()
	const next = await state.next(msg)

	next ? chats.set(chatId, next) : chats.delete(chatId)
})

void startBot().catch((error: unknown) => {
	const token = process.env.TOKEN
	const message = error instanceof Error ? error.message : "Bot stopped due to an error."
	console.error(token ? message.split(token).join("[redacted]") : message)
	process.exitCode = 1
})
