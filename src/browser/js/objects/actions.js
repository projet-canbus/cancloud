/*
 * Minio Cloud Storage (C) 2018 Minio, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import axios from "axios";
import JSZip from "jszip";
import saveAs from "file-saver";
import _ from "lodash";
import Moment from "moment";


import web from "../web";
import history from "../history";
import {
  sortObjectsByName,
  sortObjectsBySize,
  sortObjectsByDate,
  removeFirstOccurence,
  pathSlice,
  isValidLogfile
} from "../utils";
import { getCurrentBucket } from "../buckets/selectors";
import { getCurrentPrefix, getCheckedList } from "./selectors";
import * as alertActions from "../alert/actions";
import * as bucketActions from "../buckets/actions";
import * as commonActions from "../browser/actions";
import * as alertModalActions from "../alertModals/actions";
import { DELETE, DOWNLOAD } from "../constants";

export const SET_LIST = "objects/SET_LIST";
export const RESET_LIST = "object/RESET_LIST";
export const APPEND_LIST = "objects/APPEND_LIST";
export const REMOVE = "objects/REMOVE";
export const SET_SORT_BY = "objects/SET_SORT_BY";
export const SET_SORT_ORDER = "objects/SET_SORT_ORDER";
export const SET_CURRENT_PREFIX = "objects/SET_CURRENT_PREFIX";
export const SET_PREFIX_WRITABLE = "objects/SET_PREFIX_WRITABLE";
export const SET_SHARE_OBJECT = "objects/SET_SHARE_OBJECT";
export const SET_PREVIEW_OBJECT = "objects/SET_PREVIEW_OBJECT";
export const CHECKED_LIST_ADD = "objects/CHECKED_LIST_ADD";
export const CHECKED_LIST_REMOVE = "objects/CHECKED_LIST_REMOVE";
export const CHECKED_LIST_RESET = "objects/CHECKED_LIST_RESET";
export const SHOW_MANAGE_DEVICE_EDITOR = "objects/SHOW_MANAGE_DEVICE_EDITOR";
export const HIDE_MANAGE_DEVICE_EDITOR = "objects/HIDE_MANAGE_DEVICE_EDITOR";
export const OBJECT_META_INFO = "objects/OBJECT_META_INFO";
export const RESET_OBJECT_META_INFO = "objects/RESET_OBJECT_META_INFO";
export const ADD = "objects/ADD";
export const UPDATE_PROGRESS = "objects/UPDATE_PROGRESS";
export const STOP = "objects/STOP";
export const SHOW_ABORT_MODAL = "objects/SHOW_ABORT_MODAL";
export const SET_SESSION_META = "objects/SET_SESSION_META";

let source;

export const setList = (objects, err, marker, isTruncated) => ({
  type: SET_LIST,
  objects,
  err,
  marker,
  isTruncated
});

export const resetList = () => ({
  type: RESET_LIST
});

export const appendList = (objects, err, marker, isTruncated) => ({
  type: APPEND_LIST,
  objects,
  err,
  marker,
  isTruncated
});

export const stop = slug => ({
  type: STOP,
  slug
});

const showObjectMetaInfo = info => ({
  type: OBJECT_META_INFO,
  info
});

export const resetMetaInformation = () => ({
  type: RESET_OBJECT_META_INFO,
  info: []
});

export const add = (slug, size, name) => ({
  type: ADD,
  slug,
  size,
  name
});

export const updateProgress = (slug, loaded) => ({
  type: UPDATE_PROGRESS,
  slug,
  loaded
});

export const showAbortModal = () => ({
  type: SHOW_ABORT_MODAL,
  show: true
});

export const hideAbortModal = () => ({
  type: SHOW_ABORT_MODAL,
  show: false
});

export const fetchObjects = append => {
  return function(dispatch, getState) {
    if (!append) {
      dispatch(setList([], "load", null, null));
      dispatch(setSortBy(""));
      dispatch(setSortOrder(false));
    }
    const {
      buckets: { currentBucket },
      objects: { currentPrefix, marker }
    } = getState();

    if (currentBucket) {
      return web
        .ListObjects({
          bucketName: currentBucket,
          prefix: currentPrefix,
          marker: append ? marker : ""
        })
        .then(res => {
          let objects = [];
          if (res.objects) {
            objects = res.objects.map(object => {
              return {
                ...object,
                name: object.name.replace(currentPrefix, "")
              };
            });
          }
          if (append) {
            dispatch(
              appendList(objects, false, res.nextmarker, res.istruncated)
            );
          } else if (objects.length) {
            dispatch(setList(objects, false, res.nextmarker, res.istruncated));
            dispatch(setSortBy(""));
            dispatch(setSortOrder(false));
          } else {
            dispatch(
              alertActions.set({
                type: "info",
                message: `Note: This folder, ${currentBucket}, does not contain any objects`,
                autoClear: true
              })
            );
            dispatch(setList(objects, false, res.nextmarker, res.istruncated));
            dispatch(setSortBy(""));
            dispatch(setSortOrder(false));
          }
          dispatch(setPrefixWritable(res.writable));
        })
        .catch(err => {
          if (web.LoggedIn()) {
            dispatch(
              alertActions.set({
                type: "danger",
                message: err.message,
                autoClear: true
              })
            );
            dispatch(setList([], true, null, null));
            dispatch(resetList());
          } else {
            history.push("/login");
          }
        });
    } else {
      dispatch(setList([], "noBucket", null, null));
      dispatch(setSortBy(""));
      dispatch(setSortOrder(false));
    }
  };
};

export const sortObjects = sortBy => {
  return function(dispatch, getState) {
    const { objects } = getState();
    const sortOrder = objects.sortBy == sortBy ? !objects.sortOrder : true;
    dispatch(setSortBy(sortBy));
    dispatch(setSortOrder(sortOrder));
    let list;
    switch (sortBy) {
      case "name":
        list = sortObjectsByName(objects.list, sortOrder);
        break;
      case "size":
        list = sortObjectsBySize(objects.list, sortOrder);
        break;
      case "last-modified":
        list = sortObjectsByDate(objects.list, sortOrder);
        break;
      default:
        list = objects.list;
        break;
    }
    dispatch(setList(list, objects.marker, objects.isTruncated));
  };
};

export const setSortBy = sortBy => ({
  type: SET_SORT_BY,
  sortBy
});

export const setSortOrder = sortOrder => ({
  type: SET_SORT_ORDER,
  sortOrder
});

const loggerRegex = new RegExp(/([0-9A-Fa-f]){8}/, "g");

export const selectPrefix = prefix => {
  return function(dispatch, getState) {
    const currentBucket = getCurrentBucket(getState());
    const { bucket } = pathSlice(history.location.pathname);

    if (bucket == "configuration" && currentBucket != "Home") {
      return;
    }
    if (bucket == "dashboard") {
      return;
    }
    if (bucket == "status-dashboard") {
      return;
    }

    dispatch(setCurrentPrefix(prefix));
    dispatch(fetchObjects());
    dispatch(resetCheckedList());

    if (currentBucket == "Home") {
      history.replace(`/${prefix}`);
    } else {
      const path = currentBucket ? `/${currentBucket}/${prefix}` : `/${prefix}`;
      history.replace(path);
    }

  };
};

export const selectPathPrefix = prefix => {
  return function(dispatch, getState) {
    if (prefix == "Home") {
      history.replace(`/${prefix}`);
      dispatch(bucketActions.selectBucket("Home", ""));
    } else {
      const currentBucket = getCurrentBucket(getState());
      dispatch(setCurrentPrefix(prefix));
      dispatch(fetchObjects());
      dispatch(resetCheckedList());
      if (currentBucket == "Home") {
        history.replace(`/${prefix}`);
      } else {
        history.replace(`/${currentBucket}/${prefix}`);
      }
    }
  };
};

export const setCurrentPrefix = prefix => {
  return {
    type: SET_CURRENT_PREFIX,
    prefix
  };
};

export const setPrefixWritable = prefixWritable => ({
  type: SET_PREFIX_WRITABLE,
  prefixWritable
});


export const listSessionMeta = (bucket,prefix) => {
  return function(dispatch, getState) {

     let objectMetaAry = []
    return web
      .ListObjectsRecursive({
        bucketName: bucket,
        prefix: prefix,
        marker: ""
      })
      .then(res => {
        let objects = [];

        let objectsLogfiles = []
        if (res.objects) {

          // filter to only include log files
          objectsLogfiles = res.objects.filter(object => isValidLogfile(object.name))

          objects = objectsLogfiles.map(object => {
            return object.name;
          });
        }

        let objectsFirstLast = []
        let sessionMetaAry = []

        // get summary data across objects based on standard meta data (count, size range, lastModified range)
        let count = objects.length

        let lowest = Number.POSITIVE_INFINITY;
        let highest = Number.NEGATIVE_INFINITY;
        let tmp;
        let totalSize = 0
        for (var i=objectsLogfiles.length-1; i>=0; i--) {
            tmp = objectsLogfiles[i].size;
            totalSize += tmp
            if (tmp < lowest) lowest = tmp;
            if (tmp > highest) highest = tmp;
        }

        highest = (Math.round((highest/(1024*1024))*10)/10).toFixed(1).toString()
        lowest = (Math.round((lowest/(1024*1024))*10)/10).toFixed(1).toString()   
        totalSize = (Math.round((totalSize/(1024*1024))*10)/10).toFixed(1).toString()   

        let lowestDate = Moment("2200/01/01 12:00")
        let highestDate = Moment("1900/01/01 12:00")
        for (var i=objectsLogfiles.length-1; i>=0; i--) {
            tmp = Moment(objectsLogfiles[i].lastModified);
            if (tmp < lowestDate) lowestDate = tmp;
            if (tmp > highestDate) highestDate = tmp;
        }

        let lastModifiedDelta = (highestDate == lowestDate) ? 0 : highestDate.diff(lowestDate, "minutes")
        lastModifiedDelta = lastModifiedDelta == 0 ? null : lastModifiedDelta > 60 ? (Math.round((lastModifiedDelta/60)*10)/10).toString() + " hours" : (Math.round(lastModifiedDelta*10)/10).toString() + " min"
        
        highestDate = highestDate.format("YY-MM-DD HH:mm")
        lowestDate = lowestDate.format("YY-MM-DD HH:mm")


        let sizeRange = objectsLogfiles.length == 1 ? highest + " MB": lowest + "-" + highest + " MB"
        let lastModifiedRange = objectsLogfiles.length == 1 ? highestDate : lowestDate + " - " + highestDate
        
        // get custom S3 meta data for first (and last object, if there are more than one)
        if(objects.length > 1){
          objectsFirstLast = [objects[0] , objects[objects.length - 1] ]
        }else{
          objectsFirstLast = [objects[0]]
        }

        objectsFirstLast.map((object, index) => {

          return web
          .getObjectStat({
            bucketName: bucket,
            objectName: prefix + object.split("/")[2]
          })
          .then(res => {
            
            sessionMetaAry.push({object: object, meta: res.metaInfo})

            if(sessionMetaAry.length == objectsFirstLast.length){
              sessionMetaAry.sort((a, b) => (a.object > b.object) ? 1 : -1)

              let timestampStart = sessionMetaAry[0].meta.metaData && sessionMetaAry[0].meta.metaData.timestamp ? Moment.utc(sessionMetaAry[0].meta.metaData.timestamp,"YYYYMMDDTHHmmss", true).local() : null
              let timestampEnd = sessionMetaAry.length == 1 ? null : sessionMetaAry[1].meta.metaData && sessionMetaAry[1].meta.metaData.timestamp ? Moment.utc(sessionMetaAry[1].meta.metaData.timestamp,"YYYYMMDDTHHmmss", true).local() : null             
              let timestampRange = timestampStart != null ? timestampStart.format("YY-MM-DD HH:mm") + (timestampEnd != null ? " - " + timestampEnd.format("YY-MM-DD HH:mm") : "") : null
              let timestampDelta = (timestampStart != null && timestampEnd != null) ? timestampEnd.diff(timestampStart, "minutes") : 0
              timestampDelta = timestampDelta == 0 ? null : timestampDelta > 60 ? ((Math.round((timestampDelta/60)*10)/10).toString() + " hours") : Math.round((timestampDelta*10)/10).toString() + " min"

              let sessionMeta = [{count: count, totalSize: totalSize, sizeRange: sizeRange, lastModifiedRange: lastModifiedRange, lastModifiedDelta: lastModifiedDelta, timestampRange: timestampRange, timestampDelta: timestampDelta }]

              dispatch(setSessionMeta(sessionMeta))
            }
          })
          .catch(err => {
            if (web.LoggedIn()) {
              dispatch(
                alertActions.set({
                  type: "danger",
                  message: err.message,
                  autoClear: true
                })
              );
            } else {
              history.push("/login");
            }
          });
        }) 
        
      })
      .catch(err => {
        if (web.LoggedIn()) {
          dispatch(
            alertActions.set({
              type: "danger",
              message: err.message,
              autoClear: true
            })
          );
        } else {
          history.push("/login");
        }
      });
  };
};

export const setSessionMeta = sessionMeta => ({
  type: SET_SESSION_META,
  sessionMeta
});



export const directoryObjects = prefix => {
  return function(dispatch, getState) {
    const currentBucket = getCurrentBucket(getState());
    const currentPrefix = getCurrentPrefix(getState());
    return web
      .ListObjectsRecursive({
        bucketName: currentBucket,
        prefix: prefix,
        marker: ""
      })
      .then(res => {
        let objects = [];
        if (res.objects) {
          objects = res.objects.map(object => {
            return object.name;
          });
        }

        for (let i = 0; i < objects.length; i++) {
          if (currentPrefix) {
            dispatch(
              deleteObject(objects[i].split(currentPrefix).slice(-1)[0])
            );
          } else if (objects[i].includes("/")) {
            dispatch(
              deleteObject(
                removeFirstOccurence(objects[i], currentBucket + "/")
              )
            );
          } else {
            dispatch(deleteObject(objects[i]));
          }
        }
      })
      .catch(err => {
        if (web.LoggedIn()) {
          dispatch(
            alertActions.set({
              type: "danger",
              message: err.message,
              autoClear: true
            })
          );
        } else {
          history.push("/login");
        }
      });
  };
};

export const deleteObject = object => {
  return function(dispatch, getState) {
    const currentBucket = getCurrentBucket(getState());
    const currentPrefix = getCurrentPrefix(getState());
    const objectName = `${currentPrefix}${object}`;
    const totalSize = 100;
    let loaded = 0;
    dispatch(
      alertModalActions.AddQueue(DELETE, objectName, totalSize, objectName)
    );
    let pseudoInterval = setInterval(() => {
      if (loaded < 80) {
        loaded += 10;
      }
      dispatch(alertModalActions.updateQueue(objectName, loaded));
    }, 500);

    return web
      .RemoveObject({
        bucketName: currentBucket,
        objects: [objectName]
      })
      .then(() => {
        clearInterval(pseudoInterval);
        dispatch(alertModalActions.updateQueue(objectName, 100));
        if (object.includes("/")) {
          dispatch(removeObject(object.split("/")[0] + "/"));
        } else {
          dispatch(removeObject(object));
        }
        dispatch(alertModalActions.stopQueue(objectName));
      })
      .catch(e => {
        dispatch(
          alertActions.set({
            type: "danger",
            message: e.message
          })
        );
      });
  };
};

export const removeObject = object => ({
  type: REMOVE,
  object
});

export const deleteCheckedObjects = () => {
  return function(dispatch, getState) {
    const checkedObjects = getCheckedList(getState());
    const currentPrefix = getCurrentPrefix(getState());
    for (let i = 0; i < checkedObjects.length; i++) {
      if (checkedObjects[i].endsWith("/")) {
        dispatch(directoryObjects(`${currentPrefix}${checkedObjects[i]}`));
      } else {
        dispatch(deleteObject(checkedObjects[i]));
      }
    }
    dispatch(resetCheckedList());
  };
};

export const previewObject = object => {
  return function(dispatch, getState) {
    const currentBucket = getCurrentBucket(getState());
    const currentPrefix = getCurrentPrefix(getState());
    const objectName = `${currentPrefix}${object.name}`;
    return web
      .GetPartialObject({
        bucketName: currentBucket,
        objectName: objectName,
        byteLength: 10000
      })
      .then(objContent => {
        dispatch(showPreviewObject(object, objContent));
      })
      .catch(err => {
        dispatch(
          alertActions.set({
            type: "danger",
            message: err.message
          })
        );
      });
  };
};

export const shareObject = (object, days, hours, minutes) => {
  return function(dispatch, getState) {
    const currentBucket = getCurrentBucket(getState());
    const currentPrefix = getCurrentPrefix(getState());
    const objectName = `${currentPrefix}${object}`;
    const expiry = days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60;
    return web
      .PresignedGet({
        host: location.host,
        bucket: currentBucket,
        object: objectName,
        expiry
      })
      .then(obj => {
        dispatch(showShareObject(object, obj.url));
        dispatch(
          alertActions.set({
            type: "success",
            message: `Object shared. Expires in ${days} days ${hours} hours ${minutes} minutes`
          })
        );
      })
      .catch(err => {
        dispatch(
          alertActions.set({
            type: "danger",
            message: err.message
          })
        );
      });
  };
};

export const showPreviewObject = (object, content) => ({
  type: SET_PREVIEW_OBJECT,
  object: object,
  content: content,
  show: true
});

export const hidePreviewObject = (object, content) => ({
  type: SET_PREVIEW_OBJECT,
  object: object,
  content: content,
  show: false
});

export const showShareObject = (object, url) => ({
  type: SET_SHARE_OBJECT,
  show: true,
  object,
  url
});

export const hideShareObject = (object, url) => ({
  type: SET_SHARE_OBJECT,
  show: false,
  object: "",
  url: ""
});

export const downloadObject = object => {
  return function(dispatch, getState) {
    const currentBucket = getCurrentBucket(getState());
    const currentPrefix = getCurrentPrefix(getState());
    const objectName = `${currentPrefix}${object}`;
    if (web.LoggedIn()) {
      const slug = `${objectName}`;
      return web
        .PresignedGet({
          bucket: currentBucket,
          object: objectName,
          expiry: 24 * 60 * 60
        })
        .then(res => {
          const CancelToken = axios.CancelToken;
          source = CancelToken.source();
          axios({
            url: res.url,
            method: "GET",
            responseType: "blob",
            cancelToken: source.token,
            onDownloadProgress: function(progressEvent) {
              dispatch(
                alertModalActions.AddQueue(
                  DOWNLOAD,
                  slug,
                  progressEvent.total,
                  objectName
                )
              );
              dispatch(
                alertModalActions.updateQueue(slug, progressEvent.loaded)
              );
            }
          })
            .then(response => {
              dispatch(alertModalActions.stopQueue(slug));
              const url = window.URL.createObjectURL(new Blob([response.data]));
              const link = document.createElement("a");
              link.href = url;
              let fileFormatedName =
                currentBucket == "Home"
                  ? `${objectName}`
                  : `${currentBucket}/${objectName}`;
              link.setAttribute("download", fileFormatedName);
              document.body.appendChild(link);
              link.click();
              dispatch(alertActions.clear());
            })
            .catch(thrown => {
              if (axios.isCancel(thrown)) {
                dispatch(alertModalActions.stopQueue(slug));
                dispatch(alertModalActions.hideAbortModal());
              } else {
                console.error(thrown.message);
              }
            });
        })
        .catch(err => {
          dispatch(
            alertActions.set({
              type: "danger",
              message: err.message
            })
          );
        });
    } else {
      dispatch(
        alertActions.set({
          type: "danger",
          message: "Please login!"
        })
      );
    }
  };
};

export const checkObject = object => ({
  type: CHECKED_LIST_ADD,
  object
});

export const uncheckObject = object => ({
  type: CHECKED_LIST_REMOVE,
  object
});

export const resetCheckedList = () => ({
  type: CHECKED_LIST_RESET
});

export const exploreobjectDirectory = (bucketName, prefix) => {
  return web.ListObjectsRecursive({
    bucketName: bucketName,
    prefix: prefix,
    marker: ""
  });
};

export const downloadCheckedObjects = () => {
  return function(dispatch, getState) {
    const state = getState();
    const req = {
      bucketName: getCurrentBucket(state),
      prefix: getCurrentPrefix(state),
      objects: getCheckedList(state)
    };
    if (!web.LoggedIn()) {
      dispatch(
        alertActions.set({
          type: "danger",
          message: "You need to be logged in to download selected objects"
        })
      );
    } else {
      dispatch(resetCheckedList());
      dispatch(
        alertActions.set({
          type: "success",
          message: `Preparing download - please wait`
        })
      );
      let objectsPromises = _.map(req.objects, function(object) {
        if (object.endsWith("/")) {
          return exploreobjectDirectory(
            req.bucketName,
            `${req.prefix}${object}`
          );
        }
        return `${req.prefix}${object}`;
      });

      Promise.all(objectsPromises).then(function(result) {
        let objectsToDownload = [];
        _.forEach(result, objValue => {
          if (typeof objValue == "object") {
            let directoryObjcets = _.map(objValue.objects, obj => ({
              name: removeFirstOccurence(obj.name, req.bucketName + "/")
            }));
            objectsToDownload = [...objectsToDownload, ...directoryObjcets];
          } else {
            objectsToDownload.push({ name: objValue });
          }
        });
        downloadObjectAsZip(
          dispatch,
          objectsToDownload,
          req.bucketName,
          req.prefix
        );
      });
    }
  };
};

// TODO: if server isCountable false for axios response i.e total size of the file
const downloadObjectAsZip = (dispatch, object, bucketName, prefix) => {
  let zip = new JSZip();
  let count = 0;
  const CancelToken = axios.CancelToken;
  source = CancelToken.source();
  const objectsUrlPromises = _.map(object, result =>
    web.PresignedGetObj({
      bucket: bucketName,
      object: `${result.name}`,
      expiry: 24 * 60 * 60
    })
  );
  const objectsStatPromises = _.map(object, result =>
    web.getObjectStat({ bucketName: bucketName, objectName: `${result.name}` })
  );
  Promise.all(objectsStatPromises).then(objStat => {
    let totalQueueSize = _.reduce(
      objStat,
      (totaSize, obj) => {
        return totaSize + obj.metaInfo.size;
      },
      0
    );

    if (totalQueueSize > 150000000) {
      dispatch(
        alertActions.set({
          type: "info",
          message: `Your download is large (${Math.round(
            totalQueueSize / 1000000
          )} MB). This may cause a browser time-out. Consider splitting up your download`,
          autoClear: true
        })
      );
    } else {
      dispatch(alertActions.clear());
    }
    Promise.all(objectsUrlPromises).then(response => {
      response.forEach((resObj, index) => {
        const result = resObj.obj;
        const slug = `${result.objectName}`;
        index
          ? dispatch(alertModalActions.AddQueue(DOWNLOAD, slug, 0, slug))
          : dispatch(
              alertModalActions.AddQueue(DOWNLOAD, slug, totalQueueSize, slug)
            );
        axios({
          url: result.url,
          method: "GET",
          responseType: "blob",
          cancelToken: source.token,
          onDownloadProgress: function(progressEvent) {
            dispatch(alertModalActions.updateQueue(slug, progressEvent.loaded));
          }
        })
          .then(response => {
            count++;
            if (response.data.size) {
              const fileName =
                bucketName == "Home"
                  ? result.objectName.replace(/\//g, "_")
                  : `${bucketName}_${result.objectName.replace(/\//g, "_")}`;
              zip.file(fileName, response.data, { binary: true });
            }
            if (count == object.length) {
              dispatch(alertModalActions.stopQueue(slug));
              zip.generateAsync({ type: "blob" }).then(function(content) {
                saveAs(content, `${bucketName}.zip`);
              });
              dispatch(alertActions.clear());
            }
          })
          .catch(thrown => {
            if (axios.isCancel(thrown)) {
              dispatch(alertModalActions.stopQueue(slug));
              dispatch(alertModalActions.hideAbortModal());
            } else {
              console.error("axios error");
            }
          });
      });
    });
  });
};

export const loadManageDeviceEditor = () => ({
  type: SHOW_MANAGE_DEVICE_EDITOR,
  show: true
});

export const HideManageDeviceEditor = () => ({
  type: HIDE_MANAGE_DEVICE_EDITOR,
  show: false
});

export const fetchObjectStat = object => {

  return function(dispatch, getState) {
    // dispatch(resetMetaInformation())
    const currentBucket = getCurrentBucket(getState());
    const currentPrefix = getCurrentPrefix(getState());
    const objectName = `${currentPrefix}${object}`;
    return web
      .getObjectStat({
        bucketName: currentBucket,
        objectName: objectName
      })
      .then(res => {
        dispatch(showObjectMetaInfo(res));
      })
      .catch(err => {
        if (web.LoggedIn()) {
          dispatch(
            alertActions.set({
              type: "danger",
              message: err.message,
              autoClear: true
            })
          );
        } else {
          history.push("/login");
        }
      });
  };
};

export const resetMetaInfo = () => {
  return function(dispatch) {
    dispatch(resetMetaInformation());
  };
};

// TODO:  Rename to handleProgressModal
export const addProgress = (slug, size, name) => {
  return function(dispatch) {
    dispatch(add(slug, size, name));
  };
};

export const handleAbortProgressModal = () => {
  return function(dispatch) {
    source.cancel();
  };
};
