import { Injectable } from '@angular/core';
import { selectSlice, stateful } from '@rx-angular/state';
import { RxActionFactory } from '@rx-angular/state/actions';
import { combineLatest, forkJoin, merge } from 'rxjs';
import { exhaustMap, map, withLatestFrom } from 'rxjs/operators';

import { injectRxState } from './rx-state';
import { TodoResource } from './todo.resource';

export type TodoFilter = 'all' | 'completed' | 'active';

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

export interface TodoState {
  todos: Todo[];
  filter: TodoFilter;
}

export interface Commands {
  create: Pick<Todo, 'text'>;
  remove: Pick<Todo, 'id'>;
  update: Pick<Todo, 'id' | 'text' | 'done'>;
  toggleAll: void;
  clearCompleted: void;
  setFilter: TodoFilter;
}

export const INITIAL_STATE: TodoState = {
  filter: 'all',
  todos: [],
};

@Injectable()
export class TodoService {
  readonly #state = injectRxState<TodoState>();
  readonly #filter$ = this.#state.select('filter');
  readonly #allTodos$ = this.#state.select('todos');
  readonly #completedTodos$ = this.#allTodos$.pipe(
    map((todos) => todos.filter((todo) => todo.done))
  );
  readonly #activeTodos$ = this.#allTodos$.pipe(
    map((todos) => todos.filter((todo) => !todo.done))
  );
  readonly #filteredTodos$ = this.#state
    .select(selectSlice(['filter', 'todos']))
    .pipe(
      map(({ todos, filter }) =>
        todos.filter(({ done }) => {
          if (filter === 'all') return true;
          if (filter === 'active') return !done;
          if (filter === 'completed') return done;
        })
      )
    );

  readonly actions = this.actionFactory.create();

  readonly vm$ = combineLatest({
    filter: this.#filter$,
    allTodos: this.#allTodos$,
    activeTodos: this.#activeTodos$,
    filteredTodos: this.#filteredTodos$,
    completedTodos: this.#completedTodos$,
  }).pipe(stateful());

  constructor(
    private readonly actionFactory: RxActionFactory<Commands>,
    private readonly todoResource: TodoResource
  ) {
    const getAll$ = this.todoResource
      .getAll()
      .pipe(map((todos) => ({ todos })));
    const setFilter$ = this.actions.setFilter$.pipe(
      map((filter) => ({ filter }))
    );
    const create$ = this.actions.create$.pipe(
      exhaustMap((todo) => this.todoResource.create(todo)),
      map((todos) => ({ todos }))
    );
    const remove$ = this.actions.remove$.pipe(
      exhaustMap((todo) => this.todoResource.remove(todo)),
      map((todos) => ({ todos }))
    );
    const update$ = this.actions.update$.pipe(
      exhaustMap((todo) => this.todoResource.update(todo)),
      map((todos) => ({ todos }))
    );
    const toggleAll$ = this.actions.toggleAll$.pipe(
      withLatestFrom(this.#allTodos$),
      exhaustMap(([, todos]) =>
        forkJoin(
          todos.map((todo) =>
            this.todoResource.update({
              ...todo,
              done: todos.every(({ done }) => !done),
            })
          )
        )
      ),
      map((todos) => ({ todos: todos.pop() ?? [] }))
    );
    const clearCompleted$ = this.actions.clearCompleted$.pipe(
      withLatestFrom(this.#completedTodos$),
      exhaustMap(([, todos]) =>
        forkJoin(todos.map((todo) => this.todoResource.remove(todo)))
      ),
      map((todos) => ({ todos: todos.pop() ?? [] }))
    );

    this.#state.set(INITIAL_STATE);
    this.#state.connect(
      merge(
        getAll$,
        setFilter$,
        create$,
        remove$,
        update$,
        toggleAll$,
        clearCompleted$
      )
    );
  }
}
