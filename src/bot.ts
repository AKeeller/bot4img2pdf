import { Bot } from "node-telegram-bot-api"
import { run } from "node-telegram-bot-api/node"
import postSetupRoutine from "./bot-post-setup"

const token = process.env.TOKEN

if (!token)
	throw new Error("Token not found. Create a .env file an put your token there.")

const botToken = token
const bot = new Bot(botToken)

export function createTelegramFileUrl(filePath: string): string {
	const encodedFilePath = filePath.split("/").map(encodeURIComponent).join("/")
	return `https://api.telegram.org/file/bot${botToken}/${encodedFilePath}`
}

export async function startBot(): Promise<void> {
	const webhookBaseUrl = process.env.WEBHOOK_URL
	if (webhookBaseUrl) {
		await postSetupRoutine(bot, botToken, webhookBaseUrl)
		return
	}

	console.log("Bot started.")
	await run(bot)
}

export default bot;
