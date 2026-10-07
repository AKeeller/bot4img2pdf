import type { Message } from "node-telegram-bot-api"
import State from "./state/state"
import { StartState } from "./state/state.start"

export default class Chats {
	private readonly states = new Map<Message['chat']['id'], State>()
	private readonly queues = new Map<Message['chat']['id'], Promise<void>>()

	constructor(private readonly createState: () => State = () => new StartState()) {}

	handle(msg: Message): Promise<void> {
		const chatId = msg.chat.id
		const previous = this.queues.get(chatId) ?? Promise.resolve()
		const result = previous.then(async () => {
			const state = this.states.get(chatId) ?? this.createState()
			const next = await state.next(msg)
			next ? this.states.set(chatId, next) : this.states.delete(chatId)
		})

		// A failed message must not prevent later messages in this chat from running.
		const settled = result.catch(() => {})
		this.queues.set(chatId, settled)
		void settled.then(() => {
			if (this.queues.get(chatId) === settled)
				this.queues.delete(chatId)
		})

		return result
	}
}
