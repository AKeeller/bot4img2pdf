import { State } from "./state";

export class EndState implements State {
	next(): State | undefined {
		return undefined
	}
	reply(): string {
		return "End State"
	}

}