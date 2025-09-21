# ================================================
# File: server/routes/__init__.py
# ================================================
# This file imports all the individual route modules.
# When the `routes` package is imported by `server/__init__.py`,
# these imports will be executed, registering the routes with the
# ComfyUI server instance.

from . import CancelDownload
from . import ClearHistory
from . import DownloadModel
from . import DownloadHuggingFace
from . import GetBaseModels
from . import GetModelDetails
from . import GetHuggingFaceDetails
from . import GetModelTypes
from . import GetModelDirs
from . import GetLibrary
from . import GetStatus
from . import OpenPath
from . import RetryDownload
from . import SearchModels
from . import HuggingFaceSearch
from . import DeleteLibraryItem
from . import LocalModelDetails
from . import ServeLocalMedia
from . import Workflows

print("[Civicomfy] All server route modules loaded.")
