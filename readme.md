# realtime-model
Firebase compatible model abstraction.

## Why
Polling / needing to hit refresh in your browser sucks. There are a lot of things that suck about Firebase too, but it's the best thing I've tried for getting past the CRUD pattern.  

To get private and unique fields working with Firebase's security rules (you'll have to roll your own), some odd data layout choices need to be made, which is what this module tries to abstract away.  

## How
```javascript
var inherits = require('inherits')
var RealtimeModel = require('realtime-model')
var Firebase = require('firebase')

var db = new Firebase('somedb.firebaseio.com')

inherits(User, RealtimeModel)

function User (storage, data) {
  this.privateFields = {
    email: true
  }

  this.uniqueFields = {
    name: true
  }

  RealtimeModel.call(this, storage, data)
}

var user = new User(firebase.child('users/0'), {
  email: 'a@b.com',
  name: 'a',
  bio: 'b'
})

user.on('update', function () {
  if (user.loaded) {
    console.log(user.data)
  }
})

user.watch()
user.update()
```

Would yield a db structure like this:
```json
{
  "users": {
    "0": {
      "name": "a",
      "bio": "b"
    }
  },
  "unique": {
    "users": {
      "name": {
        "a": "0"
      }
    }
  },
  "private": {
    "users": {
      "0": {
        "email": "a@b.com"
      }
    }
  }
}
```

## License
WTFPL