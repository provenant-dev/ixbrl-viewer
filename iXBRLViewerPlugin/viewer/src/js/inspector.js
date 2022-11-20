// Copyright 2019 Workiva Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import $ from "jquery";
import { formatNumber, wrapLabel, truncateLabel } from "./util.js";
import { ReportSearch } from "./search.js";
import { Calculation } from "./calculations.js";
import { IXBRLChart } from "./chart.js";
import { ViewerOptions } from "./viewerOptions.js";
import { Identifiers } from "./identifiers.js";
import { Menu } from "./menu.js";
import { Accordian } from "./accordian.js";
import { FactSet } from "./factset.js";
import { Fact } from "./fact.js";
import { Footnote } from "./footnote.js";
import { escapeHtml } from "./util.js";

const SEARCH_PAGE_SIZE = 100;

export function Inspector(iv) {
  /* Insert HTML and CSS styles into body */
  if ($("#ixv #iframe-container").length == 0) {
    /* AMANA: Portal extensions. Checking if inspector.html already loaded as part of portal template */
    $(require("../html/inspector.html")).prependTo("body");
    var inspector_css = require("css-loader!less-loader!../less/inspector.less").toString();
    $('<style id="ixv-style"></style>').prop("type", "text/css").text(inspector_css).appendTo("head");
  }
  /*$('<link id="ixv-favicon" type="image/x-icon" rel="shortcut icon" />')
        .attr('href', require('../img/favicon.ico'))
        .appendTo('head');*/
  this._iv = iv;
  this._chart = new IXBRLChart();
  this._viewerOptions = new ViewerOptions();
  this._selectedFacts = [];

  $(".collapsible-header").click(function () {
    var d = $(this).closest(".collapsible-section");
    d.toggleClass("collapsed");
    if (d.hasClass("collapsed")) {
      d.find(".collapsible-body").slideUp(250);
    } else {
      d.find(".collapsible-body").slideDown(250);
    }
  });
  $("#inspector .controls .search-button").click(function () {
    $(this).closest("#inspector").toggleClass("search-mode");
  });
  $("#inspector-head .back").click(function () {
    $(this).closest("#inspector").removeClass("search-mode");
  });
  this._optionsMenu = new Menu($("#display-options-menu"));
  this._signaturesMenu = new Menu($("#signatures-menu"));
  this.buildDisplayOptionsMenu();
  this.buildSignaturesMenu();

  var inspector = this;
  // Listen to messages posted to this window
  $(window).on("message", function (e) {
    inspector.handleMessage(e);
  });

  //#region PROVENANT: fact selection, signing and verification event handlers

  $(".facts-tab").click(function (event) {
    inspector.filterBarClickHandler(event);
  });  

  $("#selectBtn").click(function () {
    inspector.initFactSelection();
  });

  $("#cancelBtn").click(function () {
    inspector.removeFactSelection();
  });

  $("#doneBtn").click(function () {
    // debugger;
    var selectedFacts = inspector.selectedFacts();
    if (
      selectedFacts != null &&
      selectedFacts != undefined &&
      selectedFacts.length > 0
    ) {
      var extractedFacts = [];
      $.each(selectedFacts, (i, fact) => {
        if (fact instanceof Fact) {
          var f = {
            i: fact.id,
            // t: "",
            d: "",
            v: fact.f.v,
            c: fact.f.a.c,
            e: fact.f.a.e,
            p: fact.f.a.p,
          };
          extractedFacts.push(f);
        }
      });
      inspector.removeFactSelection();
      console.log(extractedFacts);
      window.parent.postMessage(JSON.stringify(extractedFacts), "*");
    }
    console.log(selectedFacts);
  });

  //#endregion
}

Inspector.prototype.initialize = function (report) {
  var inspector = this;
  return new Promise(function (resolve, reject) {
    inspector._report = report;
    report.setViewerOptions(inspector._viewerOptions);
    inspector._iv.setProgress("Building search index").then(() => {
      inspector._search = new ReportSearch(report);
      inspector.setupSearchControls();
      inspector.buildDisplayOptionsMenu();
      inspector.buildSignaturesMenu();
      resolve();
    });
  });
};

Inspector.prototype.setViewer = function (viewer) {
  this._viewer = viewer;
  viewer.onSelect.add((id, eltSet) => this.selectItem(id, eltSet));
  viewer.onMouseEnter.add((id) => this.viewerMouseEnter(id));
  viewer.onMouseLeave.add((id) => this.viewerMouseLeave(id));
  $(".ixbrl-next-tag").click(() => viewer.selectNextTag());
  $(".ixbrl-prev-tag").click(() => viewer.selectPrevTag());
  this.search();
};

/*
 * Check for fragment identifier pointing to a specific fact and select it if
 * present.
 */
Inspector.prototype.handleFactDeepLink = function () {
  if (location.hash.startsWith("#f-")) {
    this.selectItem(location.hash.slice(3));
  }
};

Inspector.prototype.handleMessage = function (event) {
  var jsonString = event.originalEvent.data;
  var data = JSON.parse(jsonString);

  if (data.task == "SHOW_FACT") {
    this.selectItem(data.factId, undefined, true);
  } else {
    console.log("Not handling unsupported task message: " + jsonString);
  }
};

Inspector.prototype.updateURLFragment = function () {
  if (this._currentItem) {
    location.hash = "#f-" + this._currentItem.id;
  } else {
    location.hash = "";
  }
};

Inspector.prototype.buildDisplayOptionsMenu = function () {
  var inspector = this;
  this._optionsMenu.reset();
  this._optionsMenu.addCheckboxItem(
    "Highlight",
    function (checked) {
      inspector.highlightAllTags(checked);
    },
    "highlight-tags"
  );
  if (this._report) {
    var dl = this.selectDefaultLanguage();
    this._optionsMenu.addCheckboxGroup(
      this._report.availableLanguages(),
      this._report.languageNames(),
      dl,
      function (lang) {
        inspector.setLanguage(lang);
      },
      "select-language"
    );
    this.setLanguage(dl);
  }
  this._iv.callPluginMethod("extendDisplayOptionsMenu", this._optionsMenu);
};

Inspector.prototype.buildSignaturesMenu = function () {
  var inspector = this;
  this._signaturesMenu.reset();
  if (this._report) {
    let credMap = this._report.credentials();
    this._report.availableCredentials().forEach((credId, idx) => {
      let cred = credMap[credId];
      this._signaturesMenu.addCredentialItem(
        cred,
        idx,
        "",
        function (checked) {
          inspector.highlightSignedTags(checked, credId, "ixbrl-signed-" + idx);
        },
        "select-credential"
      );
    });
  }
};

Inspector.prototype.highlightTags = function (checked, credId) {
  let cred = this._report.credentials()[credId];
  if ("f" in cred) {
    let factIds = cred["f"].map((fact) => {
      return fact["i"];
    });
    this._viewer.highlightTags(checked, factIds);
  } else {
    var inspector = this;
    this._viewer.highlightAllTags(checked, inspector._report.namespaceGroups());
  }
};

Inspector.prototype.highlightAllTags = function (checked) {
  var inspector = this;
  this._viewer.highlightAllTags(checked, inspector._report.namespaceGroups());
};

Inspector.prototype.highlightSignedTags = function (
  checked,
  credId,
  signedClass
) {
  let cred = this._report.credentials()[credId];
  if ("f" in cred) {
    let factIds = cred["f"].map((fact) => {
      return fact["i"];
    });
    this._viewer.highlightSignedTags(checked, factIds, signedClass);
  } else {
    var inspector = this;
    this._viewer.highlightAllSignedTags(
      checked,
      inspector._report.namespaceGroups(),
      signedClass
    );
  }
};

Inspector.prototype.highlightAllSignedTags = function (checked, signedClass) {
  var inspector = this;
  this._viewer.highlightAllTags(
    checked,
    inspector._report.namespaceGroups(),
    signedClass
  );
};

Inspector.prototype.factListRow = function (f) {
  var row = $('<div class="fact-list-item"></div>')
    .click(() => this.selectItem(f.id))
    .dblclick(() => $("#inspector").removeClass("search-mode"))
    .mousedown(function (e) {
      /* Prevents text selection via double click without
       * disabling click+drag text selection (which user-select:
       * none would )
       */
      if (e.detail > 1) {
        e.preventDefault();
      }
    })
    .mouseenter(() => this._viewer.linkedHighlightFact(f))
    .mouseleave(() => this._viewer.clearLinkedHighlightFact(f))
    .data("ivid", f.id);

  row.append('<a href="#" class="view-details">View details</a>');

  // $('<div class="select-icon"></div>')
  //     .click(() => {
  //         this.selectItem(f.id);
  //         $('#inspector').removeClass("search-mode");
  //     })
  //     .appendTo(row)
  $('<input type="checkbox" class="fact-select-button hide"></input>')
    .click((event) => {
      this.selectFactForSigning(f.id, event);
    })
    .appendTo(row);
  // $('<div class="extract-fact"></div>')
  //     .click((event) => {
  //         this.selectFactForSigning(f.id, event);
  //     })
  //     .appendTo(row)

  $('<div class="title"></div>')
    .text(f.getLabel("std") || f.conceptName())
    .appendTo(row);
  $('<div class="dimension"></div>').text(f.period().toString()).appendTo(row);

  var dims = f.dimensions();
  for (var d in dims) {
    $('<div class="dimension"></div>')
      .text(f.report().getLabel(dims[d], "std", true) || dims[d])
      .appendTo(row);
  }
  if (f.isHidden()) {
    $('<div class="hidden">Hidden fact</div>').appendTo(row);
  }
  return row;
};

Inspector.prototype.addResults = function (container, results, offset) {
  $(".more-results", container).remove();
  for (var i = offset; i < results.length; i++) {
    if (i - offset >= SEARCH_PAGE_SIZE) {
      $('<div class="more-results"></div>')
        .text("Show more results")
        .click(() => this.addResults(container, results, i))
        .appendTo(container);
      break;
    }
    this.factListRow(results[i].fact).appendTo(container);
  }
};

Inspector.prototype.searchSpec = function () {
  var spec = {};
  spec.searchString = $("#ixbrl-search").val();
  spec.showVisibleFacts = $("#search-visible-fact-filter").prop("checked");
  spec.showHiddenFacts = $("#search-hidden-fact-filter").prop("checked");
  spec.periodFilter = $("#search-filter-period").val();
  spec.conceptTypeFilter = $("#search-filter-concept-type").val();
  return spec;
};

Inspector.prototype.setupSearchControls = function (viewer) {
  var inspector = this;
  $(".search-controls input, .search-controls select").change(() =>
    this.search()
  );
  $(".search-controls div.filter-toggle").click(() =>
    $(".search-controls").toggleClass("show-filters")
  );
  $(".search-controls .search-filters .reset").click(() =>
    this.resetSearchFilters()
  );
  $("#search-filter-period")
    .empty()
    .append($('<option value="*">ALL</option>'));
  for (const key in this._search.periods) {
    $("<option>")
      .attr("value", key)
      .text(this._search.periods[key])
      .appendTo("#search-filter-period");
  }
};

Inspector.prototype.resetSearchFilters = function () {
  $("#search-filter-period").val("*");
  $("#search-filter-concept-type").val("*");
  $("#search-hidden-fact-filter").prop("checked", true);
  $("#search-visible-fact-filter").prop("checked", true);
  this.search();
};

Inspector.prototype.search = function () {
  var spec = this.searchSpec();
  var results = this._search.search(spec);
  var viewer = this._viewer;
  var container = $("#inspector .search-results .results");
  $("div", container).remove();
  viewer.clearRelatedHighlighting();
  var overlay = $("#inspector .search-results .search-overlay");
  if (results.length > 0) {
    overlay.hide();
    this.addResults(container, results, 0);
  } else {
    $(".title", overlay).text("No Match Found");
    $(".text", overlay).text("Try again with different keywords");
    overlay.show();
  }
  /* Don't highlight search results if there's no search string */
  if (spec.searchString != "") {
    viewer.highlightRelatedFacts($.map(results, (r) => r.fact));
  }
};

Inspector.prototype.updateCalculation = function (fact, elr) {
  $(".calculations .tree").empty().append(this._calculationHTML(fact, elr));
};

Inspector.prototype.updateSignatures = function (fact, elr) {
  $(".signatures .tree").empty().append(this._signatureHTML(fact, elr));
};

Inspector.prototype.updateValidationResults = function (fact) {
  $("#inspector .fact-validation-results").empty();
  if (fact.hasValidationResults()) {
    var a = new Accordian({
      alwaysOpen: true,
    });
    // $.each(fact.getValidationResults(), function(i,r) {
    //     var title = $('<span></span>').text(r.ruleId);
    //     var messageBody = $('<div class="validation-result"></div>').text(r.message);
    //     a.addCard(title, messageBody);
    // });
    let content = "";
    $.each(fact.getValidationResults(), function (i, r) {
      let fabClass = "";
      switch (r.severity) {
        case 0:
          fabClass = "green";
          break;
        case 1:
          fabClass = "yellow";
          break;
        case 2:
          fabClass = "red";
          break;
      }
      content += `<p class='fab-container'><div class='fab ${fabClass}'></div><span class='fab-text'>${escapeHtml(
        r.message.trim()
      )}</span></p>\n`;
    });
    var title = $("<span></span>").text("Results");
    var messageBody = $('<div class="validation-result"></div>').html(content);
    a.addCard(title, messageBody);
    a.contents().appendTo("#inspector .fact-validation-results");
  } else {
    $('<div class="no-fact-selected"><span>No issues</span></div>').appendTo(
      "#inspector .fact-validation-results"
    );
  }
};

Inspector.prototype.updateFootnotes = function (fact) {
  $(".footnotes").empty().append(this._footnotesHTML(fact));
};

Inspector.prototype._referencesHTML = function (fact) {
  var c = fact.concept();
  var a = new Accordian();
  $.each(fact.concept().references(), function (i, r) {
    var title = $("<span></span>").text(r[0].value);
    var body = $('<table class="fact-properties"><tbody></tbody></table>');
    var tbody = body.find("tbody");
    $.each(r, function (j, p) {
      var row = $("<tr>")
        .append($("<th></th>").text(p.part))
        .append($("<td></td>").text(p.value))
        .appendTo(tbody);
      if (p.part == "URI") {
        row.addClass("uri");
        row.find("td").wrapInner($("<a>").attr("href", p.value));
      }
    });
    a.addCard(title, body, i == 0);
  });
  return a.contents();
};

Inspector.prototype._calculationHTML = function (fact, elr) {
  var calc = new Calculation(fact);
  if (!calc.hasCalculations()) {
    return "";
  }

  if (fact.tableHashCode() && !elr) {
    var tableFacts = this._viewer.factsInSameTable(fact);
    elr = calc.bestELRForFactSet(tableFacts);
  }
  var report = this._report;
  var viewer = this._viewer;
  var inspector = this;
  var a = new Accordian();

  $.each(calc.elrs(), function (e, rolePrefix) {
    if (elr && elr != e) return;

    var label = report.getRoleLabel(rolePrefix, inspector._viewerOptions);

    var rCalc = calc.resolvedCalculation(e);
    var calcBody = $("<div></div>");
    $.each(rCalc, function (i, r) {
      var itemHTML = $("<div></div>")
        .addClass("item")
        .append(
          $("<span></span>")
            .addClass("weight")
            .text(r.weightSign + " ")
        )
        .append(
          $("<span></span>")
            .addClass("concept-name")
            .text(report.getLabel(r.concept, "std"))
        )
        .appendTo(calcBody);

      if (r.facts) {
        itemHTML.addClass("calc-fact-link");
        itemHTML.data("ivid", r.facts);
        itemHTML.click(function () {
          inspector.selectItem(Object.values(r.facts)[0].id);
        });
        itemHTML.mouseenter(function () {
          $.each(r.facts, function (k, f) {
            viewer.linkedHighlightFact(f);
          });
        });
        itemHTML.mouseleave(function () {
          $.each(r.facts, function (k, f) {
            viewer.clearLinkedHighlightFact(f);
          });
        });
        $.each(r.facts, function (k, f) {
          viewer.highlightRelatedFact(f);
        });
      }
    });
    $("<div></div>")
      .addClass("item")
      .addClass("total")
      .append($("<span></span>").addClass("weight"))
      .append(
        $("<span></span>").addClass("concept-name").text(fact.getLabel("std"))
      )
      .appendTo(calcBody);

    a.addCard($("<span></span>").text(label), calcBody, e == elr);
  });
  return a.contents();
};

Inspector.prototype._signatureHTML = function (fact, elr) {
  let a = new Accordian();

  fact.signatures().forEach(function (signature) {
    let table = $('<table class="fact-properties"><tbody></tbody></table>');
    let tbody = table.find("tbody");
    let img = $("img.signature-icon").clone();
    let fieldName =
      signature["t"] === "oor" ? "officialRole" : "engagementContextRole";
    img.css("display", "inline");
    $("<tr>")
      .append($("<th></th>").text("Legal Name"))
      .append(
        $("<td></td>")
          .attr("align", "left")
          .text(signature["a"]["personLegalName"])
      )
      .append(
        $("<td></td>").attr("rowspan", 2).attr("align", "right").append(img)
      )
      .attr("valign", "bottom")
      .appendTo(tbody);
    $("<tr>")
      .append($("<th></th>").text("Role"))
      .append($("<td></td>").attr("colspan", 2).text(signature["a"][fieldName]))
      .appendTo(tbody);
    let lei = signature["a"]["LEI"];
    let row = $("<tr>")
      .append($("<th></th>").text("LEI"))
      .append($("<td></td>").attr("colspan", 2).text(lei))
      .appendTo(tbody);
    row.addClass("uri");
    row
      .find("td")
      .wrapInner(
        $("<a>").attr("href", "https://search.gleif.org/#/record/" + lei)
      );

    let type = signature["t"] === "oor" ? "Official" : "Engagement Context";
    a.addCard(
      $("<span></span>").text("Signature with vLEI " + type + " Role"),
      table,
      true
    );
  });

  let full = this._report.fullSignatureCredentials();
  full.forEach(function (vira) {
    let type = "";
    let fieldName = "";
    let cred = {};
    if ("oor" in vira) {
      cred = vira["oor"];
      type = "Official";
      fieldName = "officialRole";
    } else if ("ecr" in vira) {
      cred = vira["ecr"];
      type = "Engagement Context";
      fieldName = "engagementContextRole";
    } else {
      return;
    }
    let table = $('<table class="fact-properties"><tbody></tbody></table>');
    let tbody = table.find("tbody");
    let img = $("img.signature-icon").clone();
    img.css("display", "inline");
    $("<tr>")
      .append($("<th></th>").text("Legal Name"))
      .append(
        $("<td></td>").attr("align", "left").text(cred["personLegalName"])
      )
      .append(
        $("<td></td>").attr("rowspan", 2).attr("align", "right").append(img)
      )
      .attr("valign", "bottom")
      .appendTo(tbody);
    $("<tr>")
      .append($("<th></th>").text("Role"))
      .append($("<td></td>").attr("colspan", 2).text(cred[fieldName]))
      .appendTo(tbody);
    let lei = cred["LEI"];
    let row = $("<tr>")
      .append($("<th></th>").text("LEI"))
      .append($("<td></td>").attr("colspan", 2).text(lei))
      .appendTo(tbody);
    row.addClass("uri");
    row
      .find("td")
      .wrapInner(
        $("<a>").attr("href", "https://search.gleif.org/#/record/" + lei)
      );

    a.addCard(
      $("<span></span>").text("Signature with vLEI " + type + " Role"),
      table,
      true
    );
  });
  return a.contents();
};

Inspector.prototype._footnotesHTML = function (fact) {
  var html = $("<div></div>");
  $.each(fact.footnotes(), (n, fn) => {
    $("<div></div>")
      .addClass("block-list-item")
      .appendTo(html)
      .text(truncateLabel(fn.textContent(), 120))
      .mouseenter(() => this._viewer.linkedHighlightFact(fn))
      .mouseleave(() => this._viewer.clearLinkedHighlightFact(fn))
      .click(() => this.selectItem(fn.id));
  });
  return html;
};

Inspector.prototype.viewerMouseEnter = function (id) {
  $(".calculations .item")
    .filter(function () {
      return (
        $.inArray(
          id,
          $.map($(this).data("ivid"), function (f) {
            return f.id;
          })
        ) > -1
      );
    })
    .addClass("linked-highlight");
  $("#inspector .search .results tr")
    .filter(function () {
      return $(this).data("ivid") == id;
    })
    .addClass("linked-highlight");
};

Inspector.prototype.viewerMouseLeave = function (id) {
  $(".calculations .item").removeClass("linked-highlight");
  $("#inspector .search .results tr").removeClass("linked-highlight");
};

Inspector.prototype.describeChange = function (oldFact, newFact) {
  if (
    newFact.value() > 0 == oldFact.value() > 0 &&
    Math.abs(oldFact.value()) + Math.abs(newFact.value()) > 0
  ) {
    var x = ((newFact.value() - oldFact.value()) * 100) / oldFact.value();
    var t;
    if (x >= 0) {
      t = formatNumber(x, 1) + "% increase on ";
    } else {
      t = formatNumber(-1 * x, 1) + "% decrease on ";
    }
    return t;
  } else {
    return "From " + oldFact.readableValue() + " in ";
  }
};

Inspector.prototype.factLinkHTML = function (label, factList) {
  var html = $("<span></span>").text(label);
  if (factList.length > 0) {
    html
      .addClass("fact-link")
      .click(() => this.selectItem(factList[0].id))
      .mouseenter(() =>
        $.each(factList, (i, f) => this._viewer.linkedHighlightFact(f))
      )
      .mouseleave(() =>
        $.each(factList, (i, f) => this._viewer.clearLinkedHighlightFact(f))
      );
  }
  return html;
};

Inspector.prototype.getPeriodIncrease = function (fact) {
  var viewer = this._viewer;
  var inspector = this;
  if (fact.isNumeric()) {
    var otherFacts = this._report.getAlignedFacts(fact, { p: null });
    var mostRecent;
    if (fact.periodTo()) {
      $.each(otherFacts, function (i, of) {
        if (
          of.periodTo() &&
          of.periodTo() < fact.periodTo() &&
          (!mostRecent || of.periodTo() > mostRecent.periodTo()) &&
          fact.isEquivalentDuration(of)
        ) {
          mostRecent = of;
        }
      });
    }
    var s = "";
    if (mostRecent) {
      var allMostRecent = this._report.getAlignedFacts(mostRecent);
      s = $("<span></span>")
        .text(this.describeChange(mostRecent, fact))
        .append(this.factLinkHTML(mostRecent.periodString(), allMostRecent));
    } else {
      s = $("<i>").text("No prior fact");
    }
  } else {
    s = $("<i>").text("n/a").attr("title", "non-numeric fact");
  }
  $(".fact-properties tr.change td").html(s);
};

Inspector.prototype._updateValue = function (text, showAll, context) {
  var v = text;
  if (!showAll) {
    var fullLabel = text;
    var vv = wrapLabel(text, 120);
    if (vv.length > 1) {
      $("tr.value", context).addClass("truncated");
      $("tr.value .show-all", context)
        .off()
        .click(() => this._updateValue(text, true, context));
    } else {
      $("tr.value", context).removeClass("truncated");
    }
    v = vv[0];
  } else {
    $("tr.value", context).removeClass("truncated");
  }

  $("tr.value td .value", context).text(v);
};

Inspector.prototype._updateEntityIdentifier = function (fact, context) {
  var url = Identifiers.identifierURLForFact(fact);
  var cell = $("tr.entity-identifier td", context);
  cell.empty();
  if (url) {
    $("<span></span>")
      .text("[" + Identifiers.identifierNameForFact(fact) + "] ")
      .appendTo(cell);
    $('<a target="_blank"></a>')
      .attr("href", url)
      .text(fact.identifier().localname)
      .appendTo(cell);
  } else {
    cell.text(fact.f.a.e);
  }
};

Inspector.prototype._footnoteFactsHTML = function () {
  var html = $("<div></div>");
  this._currentItem.facts.forEach((fact) => {
    html.append(this.factListRow(fact));
  });
  return html;
};

Inspector.prototype._extensionAnchorsHTML = function (fact) {
  var ot = [];
  var anchors = this._report.getAnchors(fact.concept());
  if (anchors != 0) {
    ot.push($("<h4>Anchors</h4>"));
    $.each(anchors, function (_, info) {
      let { concept, wide } = info;
      let stdlabel = $('<div class="std-label anchor-label"></div>').text(
        concept.name
      );
      if (wide === 1) stdlabel.addClass("wider-anchor");
      else stdlabel.addClass("narrower-anchor");
      if (ot.length > 1) stdlabel.css("margin-top", "10px");
      ot.push(stdlabel);
      ot.push(
        $('<div class="documentation"></div>').text(
          concept.getLabel("doc") || ""
        )
      );
    });
  }
  return $.makeArray(ot);
};

/*
 * Build an accordian containing a summary of all nested facts/footnotes
 * corresponding to the current viewer selection.
 */
Inspector.prototype._selectionSummaryAccordian = function () {
  var inspector = this;
  var cf = this._currentItem;

  // dissolveSingle => title not shown if only one item in accordian
  var a = new Accordian({
    onSelect: (id) => this.switchItem(id),
    alwaysOpen: true,
    dissolveSingle: true,
  });

  var fs = new FactSet(this._currentItemList);
  $.each(this._currentItemList, (i, fact) => {
    var factHTML;
    var title = fs.minimallyUniqueLabel(fact);
    if (fact instanceof Fact) {
      factHTML = $(require("../html/fact-details.html"));
      $(".std-label", factHTML).text(
        fact.getLabel("std", true) || fact.conceptName()
      );
      $(".documentation", factHTML).text(fact.getLabel("doc") || "");
      if (fact.concept().isTaxonomyExtension()) {
        $(".anchors", factHTML).replaceWith(
          inspector._extensionAnchorsHTML(fact)
        );
      }
      $("tr.concept td", factHTML).text(fact.conceptName());
      $("tr.period td", factHTML).text(fact.periodString());
      if (fact.isNumeric()) {
        $("tr.period td", factHTML).append(
          $("<span></span>")
            .addClass("analyse")
            .text("")
            .click(() => this._chart.analyseDimension(fact, ["p"]))
        );
      }
      this._updateEntityIdentifier(fact, factHTML);
      this._updateValue(fact.readableValue(), false, factHTML);
      $("tr.accuracy td", factHTML).text(fact.readableAccuracy());
      $("#dimensions", factHTML).empty();
      var dims = fact.dimensions();
      for (var d in dims) {
        var h = $('<div class="dimension"></div>')
          .text(fact.report().getLabel(d, "std", true) || d)
          .appendTo($("#dimensions", factHTML));
        if (fact.isNumeric()) {
          h.append(
            $("<span></span>")
              .addClass("analyse")
              .text("")
              .click(() => this._chart.analyseDimension(fact, [d]))
          );
        }
        $('<div class="dimension-value"></div>')
          .text(fact.report().getLabel(dims[d], "std", true) || dims[d])
          .appendTo(h);
      }
    } else if (fact instanceof Footnote) {
      factHTML = $(require("../html/footnote-details.html"));
      this._updateValue(fact.textContent(), false, factHTML);
    }
    a.addCard(title, factHTML, fact.id == cf.id, fact.id);
  });
  return a;
};

Inspector.prototype.update = function () {
  var inspector = this;
  var cf = inspector._currentItem;
  if (!cf) {
    $("#inspector").removeClass("footnote-mode");
    $("#inspector").addClass("no-fact-selected");
  } else {
    $("#inspector").removeClass("no-fact-selected").removeClass("hidden-fact");

    $("#inspector .fact-inspector")
      .empty()
      .append(this._selectionSummaryAccordian().contents());

    if (cf instanceof Fact) {
      $("#inspector").removeClass("footnote-mode");

      this.updateCalculation(cf);
      this.updateSignatures(cf);
      this.updateFootnotes(cf);
      //this.updateAnchoring(cf);
      $("div.references").empty().append(this._referencesHTML(cf));
      $("#inspector .search-results .fact-list-item").removeClass("selected");
      $("#inspector .search-results .fact-list-item")
        .filter(function () {
          return $(this).data("ivid") == cf.id;
        })
        .addClass("selected");

      var duplicates = cf.duplicates();
      var n = 0;
      var ndup = duplicates.length;
      for (var i = 0; i < ndup; i++) {
        if (cf.id == duplicates[i].id) {
          n = i;
        }
      }
      $(".duplicates .text").text(n + 1 + " of " + ndup);
      var viewer = this._viewer;
      $(".duplicates .prev")
        .off()
        .click(() =>
          inspector.selectItem(duplicates[(n + ndup - 1) % ndup].id)
        );
      $(".duplicates .next")
        .off()
        .click(() => inspector.selectItem(duplicates[(n + 1) % ndup].id));

      this.getPeriodIncrease(cf);
      this.updateValidationResults(cf);
      if (cf.isHidden()) {
        $("#inspector").addClass("hidden-fact");
      }
    } else if (cf instanceof Footnote) {
      $("#inspector").addClass("footnote-mode");
      $("#inspector .footnote-details .footnote-facts")
        .empty()
        .append(this._footnoteFactsHTML());
    }
  }
  this.updateURLFragment();
};

/*
 * Select a fact or footnote from the report.
 *
 * Takes an ID of the item to select.  An optional list of "alternate"
 * fact/footnotes may be specified, which will be presented in an accordian.
 * This is used when the user clicks on a nested fact/footnote in the viewer,
 * so that all items corresponding to the area clicked are shown.
 *
 * If itemIdList is omitted, the currently selected item list is reset to just
 * the primary item.
 */
Inspector.prototype.selectItem = function (id, itemIdList, force) {
  if (itemIdList === undefined) {
    this._currentItemList = [this._report.getItemById(id)];
  } else {
    this._currentItemList = [];
    for (var i = 0; i < itemIdList.length; i++) {
      this._currentItemList.push(this._report.getItemById(itemIdList[i]));
    }
  }
  this.switchItem(id, force);
  this.notifySelectItem(id);
};

/*
 * AMANA extension: notify external host about selecting the new item
 */
Inspector.prototype.notifySelectItem = function (id) {
  if (typeof boundEvent !== "undefined") {
    boundEvent.updateSelection(id);
  }
};

/*
 * Switches the currently selected item.  Unlike selectItem, this does not
 * change the current list of "alternate" items.
 *
 * For facts, the "id" must be in the current alternate fact list.
 *
 * For footnotes, we currently only support a single footnote being selected.
 */
Inspector.prototype.switchItem = function (id, force) {
  if (id !== null) {
    this._currentItem = this._report.getItemById(id);
    this._viewer.showItemById(id, force);
    this._viewer.highlightItem(id);
  } else {
    this._currentItem = null;
    this._viewer.clearHighlighting();
  }
  this.update();
  this.update();
};

Inspector.prototype.selectDefaultLanguage = function () {
  var preferredLanguages = window.navigator.languages || [
    window.navigator.language || window.navigator.userLanguage,
  ];
  var al = this._report.availableLanguages();
  var res;
  $.each(preferredLanguages, function (i, pl) {
    $.each(al, function (j, l) {
      if (l.toLowerCase() == pl.toLowerCase()) {
        res = l;
      }
    });
  });
  if (res) return res;
  return this._report.availableLanguages()[0];
};

Inspector.prototype.setLanguage = function (lang) {
  this._viewerOptions.language = lang;
  this.update();
  this._search.buildSearchIndex();
};

//#region PROVENANT: fact selection, signing and verification

/*
 * Select a fact for signing.
 */
Inspector.prototype.selectFactForSigning = function (id, event) {
  debugger;
  var fact = this._report.getItemById(id);
  var target = $(event.target);
  if (fact && fact instanceof Fact) {
    var selectedFacts = this.selectedFacts();
    var isSelected = selectedFacts.some((x) => x.id === fact.id);
    if (isSelected) {
      const index = selectedFacts.indexOf(fact);
      if (index > -1) {
        selectedFacts.splice(index, 1);
      }
      target.removeClass("selected");
    } else {
      this.addSelectedFact(fact);
      target.addClass("selected");
    }
  }

  // target.toggleClass("selected");
  // $('#inspector .search-results .fact-list-item .extract-fact').removeClass('selected');
  // $('#inspector .search-results .fact-list-item .extract-fact').filter(function () { return $(this).data('ivid') == cf.id }).addClass('selected');
};

Inspector.prototype.addSelectedFact = function (fact) {
  this._selectedFacts.push(fact);
};

Inspector.prototype.selectedFacts = function () {
  return this._selectedFacts;
};

Inspector.prototype.initFactSelection = function () {
  $(".fact-select-button").removeClass("hide");
  $(".title").addClass("ml-3");
  $(".dimension").addClass("ml-3");
  $("#selectBtn").addClass("hide");
  $("#footerBar").removeClass("hide");
};

Inspector.prototype.removeFactSelection = function () {
  $(".fact-select-button").addClass("hide");
  $(".title").removeClass("ml-3");
  $(".dimension").removeClass("ml-3");
  $("#selectBtn").removeClass("hide");
  $("#footerBar").addClass("hide");
};


Inspector.prototype.filterBarClickHandler = function (event) {
  // var filterBarItems = document.getElementsByClassName("filter-bar-item");
  // filterBarItems = Object.values(filterBarItems);
  // for (var i = 0; i < filterBarItems.length; i++) {
  //   if (filterBarItems[i].id === event.target.id) {
  //     $(`#${filterBarItems[i].id}`).addClass("highlight");
  //   }
  //   if (filterBarItems[i].id !== event.target.id) {
  //     $(`#${filterBarItems[i].id}`).removeClass("highlight");
  //   }
  // }

  $(".facts-tab").removeClass("selected");
  var selectedTab = $(event.target).closest(".facts-tab");
  selectedTab.addClass("selected");
};

//#endregion PROVENANT: fact selection, signing and verification