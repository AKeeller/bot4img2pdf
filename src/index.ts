import bot, { startBot } from "./bot";
import Chats from "./chats";

const chats = new Chats()

bot.on('message', async (ctx) => {
	const msg = ctx.message
	if (!msg) return

	await chats.handle(msg)
})

void startBot().catch((error: unknown) => {
	const token = process.env.TOKEN
	const message = error instanceof Error ? error.message : "Bot stopped due to an error."
	console.error(token ? message.split(token).join("[redacted]") : message)
	process.exitCode = 1
})
