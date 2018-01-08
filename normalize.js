"use strict";

var _objectWithoutProperties2 = require("babel-runtime/helpers/objectWithoutProperties");

var _objectWithoutProperties3 = _interopRequireDefault(_objectWithoutProperties2);

var _regenerator = require("babel-runtime/regenerator");

var _regenerator2 = _interopRequireDefault(_regenerator);

var _asyncToGenerator2 = require("babel-runtime/helpers/asyncToGenerator");

var _asyncToGenerator3 = _interopRequireDefault(_asyncToGenerator2);

var _extends2 = require("babel-runtime/helpers/extends");

var _extends3 = _interopRequireDefault(_extends2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var crypto = require(`crypto`);
var deepMapKeys = require(`deep-map-keys`);
var _ = require(`lodash`);
var uuidv5 = require(`uuid/v5`);

var _require = require(`gatsby-source-filesystem`),
    createRemoteFileNode = _require.createRemoteFileNode;

var colorized = require(`./output-color`);
var conflictFieldPrefix = `wordpress_`;
// restrictedNodeFields from here https://www.gatsbyjs.org/docs/node-interface/
var restrictedNodeFields = [`id`, `children`, `parent`, `fields`, `internal`];

/**
 * Encrypts a String using md5 hash of hexadecimal digest.
 *
 * @param {any} str
 */
var digest = function digest(str) {
  return crypto.createHash(`md5`).update(str).digest(`hex`);
};

/**
 * Validate the GraphQL naming convetions & protect specific fields.
 *
 * @param {any} key
 * @returns the valid name
 */
function getValidKey(_ref) {
  var key = _ref.key,
      _ref$verbose = _ref.verbose,
      verbose = _ref$verbose === undefined ? false : _ref$verbose;

  var nkey = String(key);
  var NAME_RX = /^[_a-zA-Z][_a-zA-Z0-9]*$/;
  var changed = false;
  // Replace invalid characters
  if (!NAME_RX.test(nkey)) {
    changed = true;
    nkey = nkey.replace(/-|__|:|\.|\s/g, `_`);
  }
  // Prefix if first character isn't a letter.
  if (!NAME_RX.test(nkey.slice(0, 1))) {
    changed = true;
    nkey = `${conflictFieldPrefix}${nkey}`;
  }
  if (restrictedNodeFields.includes(nkey)) {
    changed = true;
    nkey = `${conflictFieldPrefix}${nkey}`.replace(/-|__|:|\.|\s/g, `_`);
  }
  if (changed && verbose) console.log(colorized.out(`Object with key "${key}" breaks GraphQL naming convention. Renamed to "${nkey}"`, colorized.color.Font.FgRed));

  return nkey;
}

exports.getValidKey = getValidKey;

// Remove the ACF key from the response when it's not an object
var normalizeACF = function normalizeACF(entities) {
  return entities.map(function (e) {
    if (!_.isObject(e[`acf`])) {
      delete e[`acf`];
    }
    return e;
  });
};

exports.normalizeACF = normalizeACF;

// Create entities from the few the WordPress API returns as an object for presumably
// legacy reasons.
var normalizeEntities = function normalizeEntities(entities) {
  var mapType = function mapType(e) {
    return Object.keys(e).filter(function (key) {
      return key !== `__type`;
    }).map(function (key) {
      return (0, _extends3.default)({
        id: key
      }, e[key], {
        __type: e.__type
      });
    });
  };

  return entities.reduce(function (acc, e) {
    switch (e.__type) {
      case `wordpress__wp_types`:
        return acc.concat(mapType(e));
      case `wordpress__wp_api_menus_menu_locations`:
        return acc.concat(mapType(e));
      case `wordpress__wp_statuses`:
        return acc.concat(mapType(e));
      case `wordpress__wp_taxonomies`:
        return acc.concat(mapType(e));
      case `wordpress__acf_options`:
        return acc.concat(mapType(e));
      default:
        return acc.concat(e);
    }
  }, []);
};

exports.normalizeEntities = normalizeEntities;

// Standardize ids + make sure keys are valid.
exports.standardizeKeys = function (entities) {
  return entities.map(function (e) {
    return deepMapKeys(e, function (key) {
      return key === `ID` ? getValidKey({ key: `id` }) : getValidKey({ key });
    });
  });
};

// Standardize dates on ISO 8601 version.
exports.standardizeDates = function (entities) {
  return entities.map(function (e) {
    Object.keys(e).forEach(function (key) {
      if (e[`${key}_gmt`]) {
        e[key] = new Date(e[`${key}_gmt`] + `z`).toJSON();
        delete e[`${key}_gmt`];
      }
    });

    return e;
  });
};

// Lift "rendered" fields to top-level
exports.liftRenderedField = function (entities) {
  return entities.map(function (e) {
    Object.keys(e).forEach(function (key) {
      var value = e[key];
      if (_.isObject(value) && _.isString(value.rendered)) {
        e[key] = value.rendered;
      }
    });

    return e;
  });
};

// Exclude entities of unknown shape
exports.excludeUnknownEntities = function (entities) {
  return entities.filter(function (e) {
    return e.wordpress_id;
  });
}; // Excluding entities without ID

var seedConstant = `b2012db8-fafc-5a03-915f-e6016ff32086`;
var typeNamespaces = {};
exports.createGatsbyIds = function (entities) {
  return entities.map(function (e) {
    var namespace = void 0;
    if (typeNamespaces[e.__type]) {
      namespace = typeNamespaces[e.__type];
    } else {
      typeNamespaces[e.__type] = uuidv5(e.__type, seedConstant);
      namespace = typeNamespaces[e.__type];
    }

    e.id = uuidv5(e.wordpress_id.toString(), namespace);
    return e;
  });
};

// Build foreign reference map.
exports.mapTypes = function (entities) {
  var groups = _.groupBy(entities, function (e) {
    return e.__type;
  });
  for (var groupId in groups) {
    groups[groupId] = groups[groupId].map(function (e) {
      return {
        wordpress_id: e.wordpress_id,
        id: e.id
      };
    });
  }

  return groups;
};

exports.mapAuthorsToUsers = function (entities) {
  var users = entities.filter(function (e) {
    return e.__type === `wordpress__wp_users`;
  });
  return entities.map(function (e) {
    if (e.author) {
      // Find the user
      var user = users.find(function (u) {
        return u.wordpress_id === e.author;
      });
      if (user) {
        e.author___NODE = user.id;

        // Add a link to the user to the entity.
        if (!user.all_authored_entities___NODE) {
          user.all_authored_entities___NODE = [];
        }
        user.all_authored_entities___NODE.push(e.id);
        if (!user[`authored_${e.__type}___NODE`]) {
          user[`authored_${e.__type}___NODE`] = [];
        }
        user[`authored_${e.__type}___NODE`].push(e.id);

        delete e.author;
      }
    }
    return e;
  });
};

exports.mapPostsToTagsCategories = function (entities) {
  var tags = entities.filter(function (e) {
    return e.__type === `wordpress__TAG`;
  });
  var categories = entities.filter(function (e) {
    return e.__type === `wordpress__CATEGORY`;
  });

  return entities.map(function (e) {
    if (e.__type === `wordpress__POST`) {
      // Replace tags & categories with links to their nodes.
      if (e.tags.length) {
        e.tags___NODE = e.tags.map(function (t) {
          return tags.find(function (tObj) {
            return t === tObj.wordpress_id;
          }).id;
        });
        delete e.tags;
      }
      if (e.categories.length) {
        e.categories___NODE = e.categories.map(function (c) {
          return categories.find(function (cObj) {
            return c === cObj.wordpress_id;
          }).id;
        });
        delete e.categories;
      }
    }
    return e;
  });
};

// TODO generalize this for all taxonomy types.
exports.mapTagsCategoriesToTaxonomies = function (entities) {
  return entities.map(function (e) {
    // Where should api_menus stuff link to?
    if (e.taxonomy && e.__type !== `wordpress__wp_api_menus_menus`) {
      // Replace taxonomy with a link to the taxonomy node.
      e.taxonomy___NODE = entities.find(function (t) {
        return t.wordpress_id === e.taxonomy;
      }).id;
      delete e.taxonomy;
    }
    return e;
  });
};

exports.mapEntitiesToMedia = function (entities) {
  var media = entities.filter(function (e) {
    return e.__type === `wordpress__wp_media`;
  });

  return entities.map(function (e) {
    // Map featured_media to its media node

    // Check if it's value of ACF Image field, that has 'Return value' set to
    // 'Image Object' ( https://www.advancedcustomfields.com/resources/image/ )
    var isPhotoObject = function isPhotoObject(field) {
      return _.isObject(field) && field.wordpress_id && field.url && field.width && field.height ? true : false;
    };

    var photoRegex = /\.(gif|jpg|jpeg|tiff|png)$/i;
    var isPhotoUrl = function isPhotoUrl(filename) {
      return _.isString(filename) && photoRegex.test(filename);
    };
    var isPhotoUrlAlreadyProcessed = function isPhotoUrlAlreadyProcessed(key) {
      return key == `source_url`;
    };
    var isFeaturedMedia = function isFeaturedMedia(value, key) {
      return (_.isNumber(value) || _.isBoolean(value)) && key === `featured_media`;
    };
    // ACF Gallery and similarly shaped arrays
    var isArrayOfPhotoObject = function isArrayOfPhotoObject(field) {
      return _.isArray(field) && field.length > 0 && isPhotoObject(field[0]);
    };
    var getMediaItemID = function getMediaItemID(mediaItem) {
      return mediaItem ? mediaItem.id : null;
    };

    // Try to get media node from value:
    //  - special case - check if key is featured_media and value is photo ID
    //  - check if value is photo url
    //  - check if value is ACF Image Object
    //  - check if value is ACF Gallery
    var getMediaFromValue = function getMediaFromValue(value, key) {
      if (isFeaturedMedia(value, key)) {
        return {
          mediaNodeID: _.isNumber(value) ? getMediaItemID(media.find(function (m) {
            return m.wordpress_id === value;
          })) : null,
          deleteField: true
        };
      } else if (isPhotoUrl(value) && !isPhotoUrlAlreadyProcessed(key)) {
        var mediaNodeID = getMediaItemID(media.find(function (m) {
          return m.source_url === value;
        }));
        return {
          mediaNodeID,
          deleteField: !!mediaNodeID
        };
      } else if (isPhotoObject(value)) {
        var _mediaNodeID = getMediaItemID(media.find(function (m) {
          return m.source_url === value.url;
        }));
        return {
          mediaNodeID: _mediaNodeID,
          deleteField: !!_mediaNodeID
        };
      } else if (isArrayOfPhotoObject(value)) {
        return {
          mediaNodeID: value.map(function (item) {
            return getMediaFromValue(item, key).mediaNodeID;
          }).filter(function (id) {
            return id !== null;
          }),
          deleteField: true
        };
      }
      return {
        mediaNodeID: null,
        deleteField: false
      };
    };

    var replaceFieldsInObject = function replaceFieldsInObject(object) {
      var deletedAllFields = true;
      _.each(object, function (value, key) {
        var _getMediaFromValue = getMediaFromValue(value, key),
            mediaNodeID = _getMediaFromValue.mediaNodeID,
            deleteField = _getMediaFromValue.deleteField;

        if (mediaNodeID) {
          object[`${key}___NODE`] = mediaNodeID;
        }
        if (deleteField) {
          delete object[key];
          // We found photo node (even if it has no image),
          // We can end processing this path
          return;
        } else {
          deletedAllFields = false;
        }

        if (_.isArray(value)) {
          value.forEach(function (v) {
            return replaceFieldsInObject(v);
          });
        } else if (_.isObject(value)) {
          replaceFieldsInObject(value);
        }
      });

      // Deleting fields and replacing them with links to different nodes
      // can cause build errors if object will have only linked properites:
      // https://github.com/gatsbyjs/gatsby/blob/master/packages/gatsby/src/schema/infer-graphql-input-fields.js#L205
      // Hacky workaround:
      // Adding dummy field with concrete value (not link) fixes build
      if (deletedAllFields && object && _.isObject(object)) {
        object[`dummy`] = true;
      }
    };
    replaceFieldsInObject(e);

    return e;
  });
};

// Downloads media files and removes "sizes" data as useless in Gatsby context.
exports.downloadMediaFiles = function () {
  var _ref3 = (0, _asyncToGenerator3.default)( /*#__PURE__*/_regenerator2.default.mark(function _callee2(_ref2) {
    var entities = _ref2.entities,
        store = _ref2.store,
        cache = _ref2.cache,
        createNode = _ref2.createNode;
    return _regenerator2.default.wrap(function _callee2$(_context2) {
      while (1) {
        switch (_context2.prev = _context2.next) {
          case 0:
            return _context2.abrupt("return", Promise.all(entities.map(function () {
              var _ref4 = (0, _asyncToGenerator3.default)( /*#__PURE__*/_regenerator2.default.mark(function _callee(e) {
                var fileNode;
                return _regenerator2.default.wrap(function _callee$(_context) {
                  while (1) {
                    switch (_context.prev = _context.next) {
                      case 0:
                        fileNode = void 0;

                        if (!(e.__type === `wordpress__wp_media`)) {
                          _context.next = 10;
                          break;
                        }

                        _context.prev = 2;
                        _context.next = 5;
                        return createRemoteFileNode({
                          url: e.source_url,
                          store,
                          cache,
                          createNode
                        });

                      case 5:
                        fileNode = _context.sent;
                        _context.next = 10;
                        break;

                      case 8:
                        _context.prev = 8;
                        _context.t0 = _context["catch"](2);

                      case 10:

                        if (fileNode) {
                          e.localFile___NODE = fileNode.id;
                          delete e.media_details.sizes;
                        }

                        return _context.abrupt("return", e);

                      case 12:
                      case "end":
                        return _context.stop();
                    }
                  }
                }, _callee, undefined, [[2, 8]]);
              }));

              return function (_x2) {
                return _ref4.apply(this, arguments);
              };
            }())));

          case 1:
          case "end":
            return _context2.stop();
        }
      }
    }, _callee2, undefined);
  }));

  return function (_x) {
    return _ref3.apply(this, arguments);
  };
}();

var createACFChildNodes = function createACFChildNodes(obj, entityId, topLevelIndex, type, children, createNode) {
  // Replace any child arrays with pointers to nodes
  _.each(obj, function (value, key) {
    if (_.isArray(value) && value[0] && value[0].acf_fc_layout) {
      obj[`${key}___NODE`] = value.map(function (v) {
        return createACFChildNodes(v, entityId, topLevelIndex, type + key, children, createNode).id;
      });
      delete obj[key];
    }
  });

  var acfChildNode = (0, _extends3.default)({}, obj, {
    id: entityId + topLevelIndex + type,
    parent: entityId,
    children: [],
    internal: { type, contentDigest: digest(JSON.stringify(obj)) }
  });
  createNode(acfChildNode);
  children.push(acfChildNode.id);

  return acfChildNode;
};

exports.createNodesFromEntities = function (_ref5) {
  var entities = _ref5.entities,
      createNode = _ref5.createNode;

  entities.forEach(function (e) {
    // Create subnodes for ACF Flexible layouts
    var __type = e.__type,
        entity = (0, _objectWithoutProperties3.default)(e, ["__type"]); // eslint-disable-line no-unused-vars

    var children = [];
    if (entity.acf) {
      _.each(entity.acf, function (value, key) {
        if (_.isArray(value) && value[0] && value[0].acf_fc_layout) {
          entity.acf[`${key}_${entity.type}___NODE`] = entity.acf[key].map(function (f, i) {
            var type = `WordPressAcf_${f.acf_fc_layout}`;
            delete f.acf_fc_layout;

            var acfChildNode = createACFChildNodes(f, entity.id + i, key, type, children, createNode);

            return acfChildNode.id;
          });

          delete entity.acf[key];
        }
      });
    }

    var node = (0, _extends3.default)({}, entity, {
      children,
      parent: null,
      internal: {
        type: e.__type,
        contentDigest: digest(JSON.stringify(entity))
      }
    });
    createNode(node);
  });
};
