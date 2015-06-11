module.exports = Model

var events = require('events')
var inherits = require('inherits')
var xtend = require('deep-extend')
var queue = require('queue')

inherits(Model, events.EventEmitter)

function Model (storage, data) {
  this.id = storage.key()
  this.collectionId = storage.parent().key()
  this.storage = {
    public: storage,
    private: storage.parent().parent().child('private/' + this.collectionId + '/' + this.id),
    unique: storage.parent().parent().child('unique/' + this.collectionId)
  }

  this.data = data || {}
  this._status = {}
  this._onupdate = this._onupdate.bind(this)

  events.EventEmitter.call(this)
}

Object.defineProperty(Model.prototype, 'loaded', {
  get: function () {
    return (this._status.public === 'loaded' &&
            this._status.private === 'loaded') ||
           (this._status.public === 'loaded' &&
            this._status.private === 'notFound') ||
           (this._status.public === 'notFound' &&
            this._status.private === 'loaded')
  }
})

Object.defineProperty(Model.prototype, 'notFound', {
  get: function () {
    return this._status.public === 'notFound' &&
           this._status.private === 'notFound'
  }
})

Model.prototype.watch = function () {
  if (this.watching) return
  this.watching = true
  this._status = {}

  if (this.mine && this.privateFields) {
    this.storage
      .private
      .on('value', this._onupdate)
  } else {
    this._status.private = 'notFound'
  }

  this.storage
    .public
    .on('value', this._onupdate)
}

Model.prototype.unwatch = function () {
  if (!this.watching) return
  this.watching = false

  if (this.mine && this.privateFields) {
    this.storage
      .private
      .off('value', this._onupdate)
  }

  this.storage
    .public
    .off('value', this._onupdate)
}

Model.prototype._watchOnce = function (cb) {
  var self = this
  var q = queue()
  var temp = {
    data: {},
    privateFields: this.privateFields
  }

  if (this.mine && this.privateFields) {
    q.push(function (cb) {
      self.storage
        .private
        .once('value', self._processSnapshot.bind(temp, cb), cb)
    })
  }

  q.push(function (cb) {
    self.storage
      .public
      .once('value', self._processSnapshot.bind(temp, cb), cb)
  })

  q.start(function (err) {
    if (err) return cb(err)
    cb(null, temp.data)
  })
}

Model.prototype.update = function (cb) {
  if (this.uniqueFields) {
    this._watchOnce(this._updateUnique.bind(this, cb))
  } else {
    this._updatePublicAndPrivate(cb)
  }
}

Model.prototype._updateUnique = function (cb, err, oldData) {
  if (err) return cb(err)

  var self = this
  var q = queue()

  for (var field in this.uniqueFields) (function (field) {
    var oldValue = this.computeValueForUniqueField(field, oldData[field])
    var newValue = this.computeValueForUniqueField(field, this.data[field])

    if (newValue !== oldValue) {
      var uniqueOld = oldValue !== undefined && oldValue !== null && this.storage
        .unique
        .child(field)
        .child(oldValue)

      var uniqueNew = newValue !== undefined && newValue !== null && this.storage
        .unique
        .child(field)
        .child(newValue)

      q.push(function (cb) {
        if (uniqueNew && uniqueOld) {
          uniqueNew.set(self.id, function (err) {
            if (err) return cb(err)
            uniqueOld.remove(cb)
          })
        } else if (uniqueNew) {
          uniqueNew.set(self.id, cb)
        } else if (uniqueOld) {
          uniqueOld.remove(cb)
        }
      })
    }
  }).call(this, field)

  q.start(function (err) {
    if (err) return cb(err)
    self._updatePublicAndPrivate(cb)
  })
}

Model.prototype.computeValueForUniqueField = function (field, value) {
  return value
}

Model.prototype._updatePublicAndPrivate = function (cb) {
  var publicData = {}
  var privateData = {}
  var publicStorage = this.storage.public
  var privateStorage = this.storage.private
  var q = queue()

  if (this.mine && this.privateFields) {
    for (var field in this.data) {
      if (this.privateFields[field]) {
        privateData[field] = this.data[field]
      } else {
        publicData[field] = this.data[field]
      }
    }

    q.push(
      privateStorage
        .update
        .bind(privateStorage, privateData)
    )
  } else {
    publicData = this.data
  }

  q.push(
    publicStorage
      .update
      .bind(publicStorage, publicData)
  )

  q.start(cb)
}

Model.prototype.destroy = function (cb) {
  if (this.privateFields && !this.mine) {
    return cb(new Error('cannot destroy a model with private fields that does not belong to you'))
  } else if (this.uniqueFields) {
    this._watchOnce(this._dodestroy.bind(this, cb))
  } else {
    this._dodestroy(cb)
  }
}

Model.prototype._dodestroy = function (cb, err, oldData) {
  if (err) return cb(err)
  this.data = oldData || this.data

  var q = queue()
  var publicStorage = this.storage.public
  var privateStorage = this.storage.private

  for (var field in this.uniqueFields) {
    var unique = this.storage
      .unique
      .child(field)
      .child(this.data[field])
    q.push(unique.remove.bind(unique))
  }

  if (this.mine && this.privateFields) {
    q.push(
      privateStorage
        .remove
        .bind(privateStorage)
    )
  }

  q.push(
    publicStorage
      .remove
      .bind(publicStorage)
  )

  this.unwatch()
  q.start(cb)
}

Model.prototype._processSnapshot = function (cb, snapshot) {
  var data = snapshot.val()
  var isPrivate = snapshot.ref().parent().parent().key() === 'private'

  if (this._status) {
    this._status[isPrivate ? 'private' : 'public'] = data ? 'loaded' : 'notFound'
  }

  data && xtend(this.data, data)

  cb && cb()
}

Model.prototype._onupdate = function (snapshot) {
  this._processSnapshot(null, snapshot)
  this.emit('update')
}
