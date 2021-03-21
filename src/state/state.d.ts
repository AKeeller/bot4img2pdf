export interface State {
	next(): State | undefined
	reply(): string
}