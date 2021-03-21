import { State } from "./state"
import { MiddleState } from "./state.middle"

export class StartState implements State {
	next(): State {
		return new MiddleState()
	}
	reply(): string {
		return "Start State"
	}
	
}