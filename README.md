# React Query + Firestore

```js
const { data } = useDocument('users/fernando')
```

**It's that easy.**

🔥 This library provides the hooks you need for querying Firestore, that you can actually use in production, on every screen.

⚡️ It aims to be **the fastest way to use Firestore in a React app,** both from a developer experience and app performance perspective.

🍕 This library is built on top [react-query](https://react-query.tanstack.com/), meaning you get all of its awesome benefits out-of-the-box.

You can now fetch, add, and mutate Firestore data with zero boilerplate.

## Credit

I'd like to thank [(@fernandotherojo)](https://twitter.com/fernandotherojo), this repo is a fork from his swr-firestore repo. all i did was migrating the core logic from swr to react query

make sure to check his repo: https://github.com/nandorojo/swr-firestore

## Features

- Shared state / cache between collection and document queries [(instead of Redux??)](#shared-global-state-between-documents-and-collections)
- Works with both **React** and **React Native**.
- Blazing fast
- Query collection groups
- `set`, `update`, and `add` update your global cache, instantly
- TypeScript-ready [(see docs)](#typescript-support)
- Realtime subscriptions [(example)](#simple-examples)
- Prevent memory leaks from Firestore subscriptions
- No more parsing `document.data()` from Firestore requests

...along with the features touted by [react-query](https://react-query.tanstack.com/) library:

- Transport and protocol agnostic data fetching
- Fast page navigation
- Revalidation on focus
- Interval polling
- Request deduplication
- Local mutation
- Pagination
- TypeScript ready
- SSR support
- Suspense mode
- Minimal API

## ⭐️

If you like this library, give it star

## Installation

```sh
yarn add react-query-firestore

# or
npm install react-query-firestore
```

Install firebase:

```sh
# if you're using expo:
expo install firebase

# if you aren't using expo:
yarn add firebase
# or
npm i firebase
```

## Set up

In the root of your app, **create an instance of firestore** and [(react query config object)](https://react-query.tanstack.com/reference/useQuery) and pass it to the **ReactQueryFirestoreProvider**.

If you're using `next.js`, this goes in your `pages/_app.js` file.

`App.js`

```jsx
import React from 'react'
import * as firebase from 'firebase/app'
import 'firebase/firestore'
import { ReactQueryFirestoreProvider } from 'react-query-firestore'

const reactQueryConfig = {
  queries: {
    retry: false
  }
}

export default function App() {
  return (
    <ReactQueryFirestoreProvider firestore={firebase.app().firestore()} reactQueryConfig={reactQueryConfig}>
      <YourAppHere />
    </ReactQueryFirestoreProvider>
  )
}
```

## Basic Usage

_Assuming you've already completed the setup..._

### Subscribe to a document

```js
import React from 'react'
import { useDocument } from 'react-query-firestore'
import { Text } from 'react-native'

export default function User() {
  const user = { id: 'Fernando' }
  const { data, update, error } = useDocument(`users/${user.id}`)

  if (error) return <Text>Error!</Text>
  if (!data) return <Text>Loading...</Text>

  return <Text>Name: {data.name}</Text>
}
```

### Get a collection

```js
import React from 'react'
import { useCollection } from 'react-query-firestore'
import { Text } from 'react-native'

export default function UserList() {
  const { data, add, error } = useCollection(`users`)

  if (error) return <Text>Error!</Text>
  if (!data) return <Text>Loading...</Text>

  return data.map(user => <Text key={user.id}>{user.name}</Text>)
}
```

`useDocument` accepts a document `path` as its first argument here. `useCollection` works similarly.

## Simple examples

### Query a users collection:

```typescript
const { data } = useCollection('users')
```

### Make a complex collection query:

```typescript
const { data } = useCollection('users', {}, {
  where: ['name', '==', 'fernando'],
  limit: 10,
  orderBy: ['age', 'desc'],
})
```

### Pass options from react-query to your document query:

```typescript
// pass react-query options
const { data } = useDocument('albums/nothing-was-the-same', {
  retry: false,
  onSuccess: console.log,
})
```

### Pass options from react-query to your collection query:

```typescript
// pass react-query options
const { data } = useCollection(
  'albums',
  ,
  {
    retry: false,
    onSuccess: console.log,
  }
  {
    // you can pass multiple where conditions if you want
    where: [
      ['artist', '==', 'Drake'],
      ['year', '==', '2020'],
    ],
  }
)
```

### Add data to your collection:

```typescript
const { data, add } = useCollection('albums', {
  where: ['artist', '==', 'Drake'],
})

const onPress = () => {
  // calling this will automatically update your global cache & Firestore
  add({
    title: 'Dark Lane Demo Tapes',
    artist: 'Drake',
    year: '2020',
  })
}
```

### Set document data:

```typescript
const { data, set, update } = useDocument('albums/dark-lane-demo-tapes')

const onReleaseAlbum = () => {
  // calling this will automatically update your global cache & Firestore
  set(
    {
      released: true,
    },
    { merge: true }
  )

  // or you could call this:
  update({
    released: true,
  })
}
```

### Use dynamic fields in a request:

If you pass `undefined` as the document key, the request won't send.

Once the key is set to a string, the request will send.

**Get list of users who have you in their friends list**

```typescript
import { useDoormanUser } from 'react-doorman'

const { uid } = useDoormanUser()
const { data } = useDocument(uid ? 'users/'+uid : undefined, {
  where: ['friends', 'array-contains', uid],
})
```

**Get your favorite song**

```typescript
const me = { id: 'fernando' }

const { data: user } = useDocument<{ favoriteSong: string }>(`users/${me.id}`)

// only send the request once the user.favoriteSong exists!
const { data: song } = useDocument(
  user?.favoriteSong ? `songs/${user.favoriteSong}` : undefined
)
```

## Query Documents

You'll rely on `useDocument` to query documents.

```js
import React from 'react'
import { useDocument } from 'react-query-firestore'

const user = { id: 'Fernando' }
export default () => {
  const { data, error } = useDocument(`users/${user.id}`)
}
```

# Features

## TypeScript Support

Create a model for your `typescript` types, and pass it as a generic to `useDocument` or `useCollection`.

### useDocument

The `data` item will include your TypeScript model (or `undefined`), and will also include an `id` string, an `exists` boolean, and `hasPendingWrites` boolean.

```typescript
type User = {
  name: string
}

const { data } = useDocument<User>('users/fernando')

if (data) {
  const {
    id, // string
    name, // string
    exists, // boolean
    hasPendingWrites, // boolean
  } = data
}

const id = data?.id //  string | undefined
const name = data?.name // string | undefined
const exists = data?.exists // boolean | undefined
const hasPendingWrites = data?.hasPendingWrites // boolean | undefined
```

### useCollection

The `data` item will include your TypeScript model (or `undefined`), and will also include an `id` string.

```typescript
type User = {
  name: string
}

const { data } = useCollection<User>('users')

if (data) {
  data.forEach(({ id, name }) => {
    // ...
  })
}
```

## Shared global state between documents and collections

A great feature of this library is shared data between documents and collections. Until now, this could only be achieved with something like a verbose Redux set up.

So, what does this mean exactly?

Simply put, any documents pulled from a Firestore request will update the global cache.

**To make it clear, let's look at an example.**

Imagine you query a `user` document from Firestore:

```js
const { data } = useDocument('users/fernando')
```

And pretend that this document's `data` returns the following:

```json
{ "id": "fernando", "isHungry": false }
```

_Remember that `isHungry` is `false` here ^_

Now, let's say you query the `users` collection anywhere else in your app:

```js
const { data } = useCollection('users')
```

And pretend that this collection's `data` returns the following:

```json
[
  { "id": "fernando", "isHungry": true },
  {
    //...
  }
]
```

Whoa, `isHungry` is now true. But what happens to the original document query? Will we have stale data?

**Answer:** It will automatically re-render with the new data!

`swr-firestore` uses document `id` fields to sync any collection queries with existing document queries across your app.

That means that **if you somehow fetch the same document twice, the latest version will update everywhere.**

## License

MIT
