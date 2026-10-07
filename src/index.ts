import bot, { startBot } from "./bot";
import Chats from "./chats";

const chats = new Chats()

bot.on('message', (ctx) => {
	const msg = ctx.message
	if (!msg) return

	// The polling runner awaits handlers; enqueue work so other chats can progress.
	void chats.handle(msg).catch((error: unknown) => {
		logError(error, "Error handling chat message.")
	})
})

function logError(error: unknown, fallback: string): void {
	const token = process.env.TOKEN
	const message = error instanceof Error ? error.message : fallback
	console.error(token ? message.split(token).join("[redacted]") : message)
}

void startBot().catch((error: unknown) => {
	logError(error, "Bot stopped due to an error.")
	process.exitCode = 1
})
