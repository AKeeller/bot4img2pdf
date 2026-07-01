import type { Message } from "node-telegram-bot-api";

export default interface State {
	next(msg: Message): State | undefined | Promise<State | undefined>
}