/*
 * MinIO Cloud Storage (C) 2016, 2018 MinIO, Inc.
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

import { getVisibleBuckets, getCurrentBucket } from "../selectors"

describe("getVisibleBuckets", () => {
  let state
  beforeEach(() => {
    state = {
      buckets: {
        list: ["TEST1", "TEST11", "TEST22"]
      }
    }
  })

  it("should return all buckets if no filter specified", () => {
    state.buckets.filter = ""
    expect(getVisibleBuckets(state)).toEqual(["TEST1", "TEST11", "TEST22"])
  })

  it("should return all matching buckets if filter is specified", () => {
    state.buckets.filter = "TEST1"
    expect(getVisibleBuckets(state)).toEqual(["TEST1", "TEST11"])
  })
})
