import type { Bot } from "node-telegram-bot-api"
import { createWebhookServer, fromPath } from "node-telegram-bot-api/node"
import { readFile } from "node:fs/promises"
import { createServer as createHttpsServer } from "node:https"
import type { Server } from "node:http"

const WEBHOOK_PORT = 8443

function listen(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject)
		server.listen(WEBHOOK_PORT, () => {
			server.off("error", reject)
			resolve()
		})
	})
}

function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close(error => error ? reject(error) : resolve())
	})
}

async function postSetupRoutine(bot: Bot, token: string, webhookBaseUrl: string): Promise<void> {
	const certificatePath = process.env.CERT
	const keyPath = process.env.KEY
	if (keyPath && !certificatePath)
		throw new Error("CERT must be set when configuring KEY.")

	const webhookPath = `/bot${token}`
	const adapter = createWebhookServer(bot, { path: webhookPath, allowUnauthenticated: true })
	const server = certificatePath && keyPath
		? createHttpsServer({ cert: await readFile(certificatePath), key: await readFile(keyPath) }, (request, response) => {
			adapter.emit("request", request, response)
		})
		: adapter

	await listen(server)

	try {
		const url = `${webhookBaseUrl.replace(/\/+$/, "")}${webhookPath}`
		const certificate = certificatePath ? await fromPath(certificatePath) : undefined
		await bot.api.setWebhook({ url, ...(certificate ? { certificate } : {}) })
	} catch {
		await close(server)
		throw new Error("Failed to register the Telegram webhook.")
	}

	console.log("Webhook server started.")
	await new Promise<void>((resolve, reject) => {
		const shutdown = () => server.close()
		const onError = (error: Error) => reject(error)
		server.once("close", resolve)
		server.once("error", onError)
		process.once("SIGINT", shutdown)
		process.once("SIGTERM", shutdown)
		server.once("close", () => {
			process.off("SIGINT", shutdown)
			process.off("SIGTERM", shutdown)
		})
	})
}

export default postSetupRoutine
