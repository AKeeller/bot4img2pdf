import TelegramBot from "node-telegram-bot-api"

function postSetupRoutine(bot: TelegramBot) {
	if (process.env.WEBHOOK_URL) {
		const url = `${process.env.WEBHOOK_URL}/bot${process.env.TOKEN}`
		const options = { certificate: process.env.CERT }

		bot.setWebHook(url, options)
			.then(_ => console.log(`WebHook set to ${process.env.WEBHOOK_URL}`))
			.catch(reason => setTimeout(() => { throw new Error(`${reason}`) }))
	}
}

export default postSetupRoutine