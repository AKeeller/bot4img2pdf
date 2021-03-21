import { State } from "./state"
import { EndState } from "./state.end"

export class MiddleState implements State {
	next(): State {
		return new EndState()
	}
	reply(): string {
		return "Middle State"
	}
	
}