#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/json5/lib/unicode.js
var require_unicode = __commonJS({
  "node_modules/json5/lib/unicode.js"(exports2, module2) {
    module2.exports.Space_Separator = /[\u1680\u2000-\u200A\u202F\u205F\u3000]/;
    module2.exports.ID_Start = /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u0860-\u086A\u08A0-\u08B4\u08B6-\u08BD\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u09FC\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C60\u0C61\u0C80\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D54-\u0D56\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u1884\u1887-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1C80-\u1C88\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312E\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FEA\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA7AE\uA7B0-\uA7B7\uA7F7-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB65\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]|\uD800[\uDC00-\uDC0B\uDC0D-\uDC26\uDC28-\uDC3A\uDC3C\uDC3D\uDC3F-\uDC4D\uDC50-\uDC5D\uDC80-\uDCFA\uDD40-\uDD74\uDE80-\uDE9C\uDEA0-\uDED0\uDF00-\uDF1F\uDF2D-\uDF4A\uDF50-\uDF75\uDF80-\uDF9D\uDFA0-\uDFC3\uDFC8-\uDFCF\uDFD1-\uDFD5]|\uD801[\uDC00-\uDC9D\uDCB0-\uDCD3\uDCD8-\uDCFB\uDD00-\uDD27\uDD30-\uDD63\uDE00-\uDF36\uDF40-\uDF55\uDF60-\uDF67]|\uD802[\uDC00-\uDC05\uDC08\uDC0A-\uDC35\uDC37\uDC38\uDC3C\uDC3F-\uDC55\uDC60-\uDC76\uDC80-\uDC9E\uDCE0-\uDCF2\uDCF4\uDCF5\uDD00-\uDD15\uDD20-\uDD39\uDD80-\uDDB7\uDDBE\uDDBF\uDE00\uDE10-\uDE13\uDE15-\uDE17\uDE19-\uDE33\uDE60-\uDE7C\uDE80-\uDE9C\uDEC0-\uDEC7\uDEC9-\uDEE4\uDF00-\uDF35\uDF40-\uDF55\uDF60-\uDF72\uDF80-\uDF91]|\uD803[\uDC00-\uDC48\uDC80-\uDCB2\uDCC0-\uDCF2]|\uD804[\uDC03-\uDC37\uDC83-\uDCAF\uDCD0-\uDCE8\uDD03-\uDD26\uDD50-\uDD72\uDD76\uDD83-\uDDB2\uDDC1-\uDDC4\uDDDA\uDDDC\uDE00-\uDE11\uDE13-\uDE2B\uDE80-\uDE86\uDE88\uDE8A-\uDE8D\uDE8F-\uDE9D\uDE9F-\uDEA8\uDEB0-\uDEDE\uDF05-\uDF0C\uDF0F\uDF10\uDF13-\uDF28\uDF2A-\uDF30\uDF32\uDF33\uDF35-\uDF39\uDF3D\uDF50\uDF5D-\uDF61]|\uD805[\uDC00-\uDC34\uDC47-\uDC4A\uDC80-\uDCAF\uDCC4\uDCC5\uDCC7\uDD80-\uDDAE\uDDD8-\uDDDB\uDE00-\uDE2F\uDE44\uDE80-\uDEAA\uDF00-\uDF19]|\uD806[\uDCA0-\uDCDF\uDCFF\uDE00\uDE0B-\uDE32\uDE3A\uDE50\uDE5C-\uDE83\uDE86-\uDE89\uDEC0-\uDEF8]|\uD807[\uDC00-\uDC08\uDC0A-\uDC2E\uDC40\uDC72-\uDC8F\uDD00-\uDD06\uDD08\uDD09\uDD0B-\uDD30\uDD46]|\uD808[\uDC00-\uDF99]|\uD809[\uDC00-\uDC6E\uDC80-\uDD43]|[\uD80C\uD81C-\uD820\uD840-\uD868\uD86A-\uD86C\uD86F-\uD872\uD874-\uD879][\uDC00-\uDFFF]|\uD80D[\uDC00-\uDC2E]|\uD811[\uDC00-\uDE46]|\uD81A[\uDC00-\uDE38\uDE40-\uDE5E\uDED0-\uDEED\uDF00-\uDF2F\uDF40-\uDF43\uDF63-\uDF77\uDF7D-\uDF8F]|\uD81B[\uDF00-\uDF44\uDF50\uDF93-\uDF9F\uDFE0\uDFE1]|\uD821[\uDC00-\uDFEC]|\uD822[\uDC00-\uDEF2]|\uD82C[\uDC00-\uDD1E\uDD70-\uDEFB]|\uD82F[\uDC00-\uDC6A\uDC70-\uDC7C\uDC80-\uDC88\uDC90-\uDC99]|\uD835[\uDC00-\uDC54\uDC56-\uDC9C\uDC9E\uDC9F\uDCA2\uDCA5\uDCA6\uDCA9-\uDCAC\uDCAE-\uDCB9\uDCBB\uDCBD-\uDCC3\uDCC5-\uDD05\uDD07-\uDD0A\uDD0D-\uDD14\uDD16-\uDD1C\uDD1E-\uDD39\uDD3B-\uDD3E\uDD40-\uDD44\uDD46\uDD4A-\uDD50\uDD52-\uDEA5\uDEA8-\uDEC0\uDEC2-\uDEDA\uDEDC-\uDEFA\uDEFC-\uDF14\uDF16-\uDF34\uDF36-\uDF4E\uDF50-\uDF6E\uDF70-\uDF88\uDF8A-\uDFA8\uDFAA-\uDFC2\uDFC4-\uDFCB]|\uD83A[\uDC00-\uDCC4\uDD00-\uDD43]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D\uDC20-\uDFFF]|\uD873[\uDC00-\uDEA1\uDEB0-\uDFFF]|\uD87A[\uDC00-\uDFE0]|\uD87E[\uDC00-\uDE1D]/;
    module2.exports.ID_Continue = /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u0860-\u086A\u08A0-\u08B4\u08B6-\u08BD\u08D4-\u08E1\u08E3-\u0963\u0966-\u096F\u0971-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u09FC\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0AF9-\u0AFF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C00-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58-\u0C5A\u0C60-\u0C63\u0C66-\u0C6F\u0C80-\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D00-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D54-\u0D57\u0D5F-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191E\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1AB0-\u1ABD\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1C80-\u1C88\u1CD0-\u1CD2\u1CD4-\u1CF9\u1D00-\u1DF9\u1DFB-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312E\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FEA\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA7AE\uA7B0-\uA7B7\uA7F7-\uA827\uA840-\uA873\uA880-\uA8C5\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA8FD\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uA9E0-\uA9FE\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB65\uAB70-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE2F\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]|\uD800[\uDC00-\uDC0B\uDC0D-\uDC26\uDC28-\uDC3A\uDC3C\uDC3D\uDC3F-\uDC4D\uDC50-\uDC5D\uDC80-\uDCFA\uDD40-\uDD74\uDDFD\uDE80-\uDE9C\uDEA0-\uDED0\uDEE0\uDF00-\uDF1F\uDF2D-\uDF4A\uDF50-\uDF7A\uDF80-\uDF9D\uDFA0-\uDFC3\uDFC8-\uDFCF\uDFD1-\uDFD5]|\uD801[\uDC00-\uDC9D\uDCA0-\uDCA9\uDCB0-\uDCD3\uDCD8-\uDCFB\uDD00-\uDD27\uDD30-\uDD63\uDE00-\uDF36\uDF40-\uDF55\uDF60-\uDF67]|\uD802[\uDC00-\uDC05\uDC08\uDC0A-\uDC35\uDC37\uDC38\uDC3C\uDC3F-\uDC55\uDC60-\uDC76\uDC80-\uDC9E\uDCE0-\uDCF2\uDCF4\uDCF5\uDD00-\uDD15\uDD20-\uDD39\uDD80-\uDDB7\uDDBE\uDDBF\uDE00-\uDE03\uDE05\uDE06\uDE0C-\uDE13\uDE15-\uDE17\uDE19-\uDE33\uDE38-\uDE3A\uDE3F\uDE60-\uDE7C\uDE80-\uDE9C\uDEC0-\uDEC7\uDEC9-\uDEE6\uDF00-\uDF35\uDF40-\uDF55\uDF60-\uDF72\uDF80-\uDF91]|\uD803[\uDC00-\uDC48\uDC80-\uDCB2\uDCC0-\uDCF2]|\uD804[\uDC00-\uDC46\uDC66-\uDC6F\uDC7F-\uDCBA\uDCD0-\uDCE8\uDCF0-\uDCF9\uDD00-\uDD34\uDD36-\uDD3F\uDD50-\uDD73\uDD76\uDD80-\uDDC4\uDDCA-\uDDCC\uDDD0-\uDDDA\uDDDC\uDE00-\uDE11\uDE13-\uDE37\uDE3E\uDE80-\uDE86\uDE88\uDE8A-\uDE8D\uDE8F-\uDE9D\uDE9F-\uDEA8\uDEB0-\uDEEA\uDEF0-\uDEF9\uDF00-\uDF03\uDF05-\uDF0C\uDF0F\uDF10\uDF13-\uDF28\uDF2A-\uDF30\uDF32\uDF33\uDF35-\uDF39\uDF3C-\uDF44\uDF47\uDF48\uDF4B-\uDF4D\uDF50\uDF57\uDF5D-\uDF63\uDF66-\uDF6C\uDF70-\uDF74]|\uD805[\uDC00-\uDC4A\uDC50-\uDC59\uDC80-\uDCC5\uDCC7\uDCD0-\uDCD9\uDD80-\uDDB5\uDDB8-\uDDC0\uDDD8-\uDDDD\uDE00-\uDE40\uDE44\uDE50-\uDE59\uDE80-\uDEB7\uDEC0-\uDEC9\uDF00-\uDF19\uDF1D-\uDF2B\uDF30-\uDF39]|\uD806[\uDCA0-\uDCE9\uDCFF\uDE00-\uDE3E\uDE47\uDE50-\uDE83\uDE86-\uDE99\uDEC0-\uDEF8]|\uD807[\uDC00-\uDC08\uDC0A-\uDC36\uDC38-\uDC40\uDC50-\uDC59\uDC72-\uDC8F\uDC92-\uDCA7\uDCA9-\uDCB6\uDD00-\uDD06\uDD08\uDD09\uDD0B-\uDD36\uDD3A\uDD3C\uDD3D\uDD3F-\uDD47\uDD50-\uDD59]|\uD808[\uDC00-\uDF99]|\uD809[\uDC00-\uDC6E\uDC80-\uDD43]|[\uD80C\uD81C-\uD820\uD840-\uD868\uD86A-\uD86C\uD86F-\uD872\uD874-\uD879][\uDC00-\uDFFF]|\uD80D[\uDC00-\uDC2E]|\uD811[\uDC00-\uDE46]|\uD81A[\uDC00-\uDE38\uDE40-\uDE5E\uDE60-\uDE69\uDED0-\uDEED\uDEF0-\uDEF4\uDF00-\uDF36\uDF40-\uDF43\uDF50-\uDF59\uDF63-\uDF77\uDF7D-\uDF8F]|\uD81B[\uDF00-\uDF44\uDF50-\uDF7E\uDF8F-\uDF9F\uDFE0\uDFE1]|\uD821[\uDC00-\uDFEC]|\uD822[\uDC00-\uDEF2]|\uD82C[\uDC00-\uDD1E\uDD70-\uDEFB]|\uD82F[\uDC00-\uDC6A\uDC70-\uDC7C\uDC80-\uDC88\uDC90-\uDC99\uDC9D\uDC9E]|\uD834[\uDD65-\uDD69\uDD6D-\uDD72\uDD7B-\uDD82\uDD85-\uDD8B\uDDAA-\uDDAD\uDE42-\uDE44]|\uD835[\uDC00-\uDC54\uDC56-\uDC9C\uDC9E\uDC9F\uDCA2\uDCA5\uDCA6\uDCA9-\uDCAC\uDCAE-\uDCB9\uDCBB\uDCBD-\uDCC3\uDCC5-\uDD05\uDD07-\uDD0A\uDD0D-\uDD14\uDD16-\uDD1C\uDD1E-\uDD39\uDD3B-\uDD3E\uDD40-\uDD44\uDD46\uDD4A-\uDD50\uDD52-\uDEA5\uDEA8-\uDEC0\uDEC2-\uDEDA\uDEDC-\uDEFA\uDEFC-\uDF14\uDF16-\uDF34\uDF36-\uDF4E\uDF50-\uDF6E\uDF70-\uDF88\uDF8A-\uDFA8\uDFAA-\uDFC2\uDFC4-\uDFCB\uDFCE-\uDFFF]|\uD836[\uDE00-\uDE36\uDE3B-\uDE6C\uDE75\uDE84\uDE9B-\uDE9F\uDEA1-\uDEAF]|\uD838[\uDC00-\uDC06\uDC08-\uDC18\uDC1B-\uDC21\uDC23\uDC24\uDC26-\uDC2A]|\uD83A[\uDC00-\uDCC4\uDCD0-\uDCD6\uDD00-\uDD4A\uDD50-\uDD59]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D\uDC20-\uDFFF]|\uD873[\uDC00-\uDEA1\uDEB0-\uDFFF]|\uD87A[\uDC00-\uDFE0]|\uD87E[\uDC00-\uDE1D]|\uDB40[\uDD00-\uDDEF]/;
  }
});

// node_modules/json5/lib/util.js
var require_util = __commonJS({
  "node_modules/json5/lib/util.js"(exports2, module2) {
    var unicode = require_unicode();
    module2.exports = {
      isSpaceSeparator(c) {
        return typeof c === "string" && unicode.Space_Separator.test(c);
      },
      isIdStartChar(c) {
        return typeof c === "string" && (c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "$" || c === "_" || unicode.ID_Start.test(c));
      },
      isIdContinueChar(c) {
        return typeof c === "string" && (c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c >= "0" && c <= "9" || c === "$" || c === "_" || c === "\u200C" || c === "\u200D" || unicode.ID_Continue.test(c));
      },
      isDigit(c) {
        return typeof c === "string" && /[0-9]/.test(c);
      },
      isHexDigit(c) {
        return typeof c === "string" && /[0-9A-Fa-f]/.test(c);
      }
    };
  }
});

// node_modules/json5/lib/parse.js
var require_parse = __commonJS({
  "node_modules/json5/lib/parse.js"(exports2, module2) {
    var util = require_util();
    var source;
    var parseState;
    var stack;
    var pos;
    var line;
    var column;
    var token;
    var key;
    var root;
    module2.exports = function parse(text, reviver) {
      source = String(text);
      parseState = "start";
      stack = [];
      pos = 0;
      line = 1;
      column = 0;
      token = void 0;
      key = void 0;
      root = void 0;
      do {
        token = lex();
        parseStates[parseState]();
      } while (token.type !== "eof");
      if (typeof reviver === "function") {
        return internalize({ "": root }, "", reviver);
      }
      return root;
    };
    function internalize(holder, name, reviver) {
      const value = holder[name];
      if (value != null && typeof value === "object") {
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const key2 = String(i);
            const replacement = internalize(value, key2, reviver);
            if (replacement === void 0) {
              delete value[key2];
            } else {
              Object.defineProperty(value, key2, {
                value: replacement,
                writable: true,
                enumerable: true,
                configurable: true
              });
            }
          }
        } else {
          for (const key2 in value) {
            const replacement = internalize(value, key2, reviver);
            if (replacement === void 0) {
              delete value[key2];
            } else {
              Object.defineProperty(value, key2, {
                value: replacement,
                writable: true,
                enumerable: true,
                configurable: true
              });
            }
          }
        }
      }
      return reviver.call(holder, name, value);
    }
    var lexState;
    var buffer;
    var doubleQuote;
    var sign;
    var c;
    function lex() {
      lexState = "default";
      buffer = "";
      doubleQuote = false;
      sign = 1;
      for (; ; ) {
        c = peek();
        const token2 = lexStates[lexState]();
        if (token2) {
          return token2;
        }
      }
    }
    function peek() {
      if (source[pos]) {
        return String.fromCodePoint(source.codePointAt(pos));
      }
    }
    function read() {
      const c2 = peek();
      if (c2 === "\n") {
        line++;
        column = 0;
      } else if (c2) {
        column += c2.length;
      } else {
        column++;
      }
      if (c2) {
        pos += c2.length;
      }
      return c2;
    }
    var lexStates = {
      default() {
        switch (c) {
          case "	":
          case "\v":
          case "\f":
          case " ":
          case "\xA0":
          case "\uFEFF":
          case "\n":
          case "\r":
          case "\u2028":
          case "\u2029":
            read();
            return;
          case "/":
            read();
            lexState = "comment";
            return;
          case void 0:
            read();
            return newToken("eof");
        }
        if (util.isSpaceSeparator(c)) {
          read();
          return;
        }
        return lexStates[parseState]();
      },
      comment() {
        switch (c) {
          case "*":
            read();
            lexState = "multiLineComment";
            return;
          case "/":
            read();
            lexState = "singleLineComment";
            return;
        }
        throw invalidChar(read());
      },
      multiLineComment() {
        switch (c) {
          case "*":
            read();
            lexState = "multiLineCommentAsterisk";
            return;
          case void 0:
            throw invalidChar(read());
        }
        read();
      },
      multiLineCommentAsterisk() {
        switch (c) {
          case "*":
            read();
            return;
          case "/":
            read();
            lexState = "default";
            return;
          case void 0:
            throw invalidChar(read());
        }
        read();
        lexState = "multiLineComment";
      },
      singleLineComment() {
        switch (c) {
          case "\n":
          case "\r":
          case "\u2028":
          case "\u2029":
            read();
            lexState = "default";
            return;
          case void 0:
            read();
            return newToken("eof");
        }
        read();
      },
      value() {
        switch (c) {
          case "{":
          case "[":
            return newToken("punctuator", read());
          case "n":
            read();
            literal("ull");
            return newToken("null", null);
          case "t":
            read();
            literal("rue");
            return newToken("boolean", true);
          case "f":
            read();
            literal("alse");
            return newToken("boolean", false);
          case "-":
          case "+":
            if (read() === "-") {
              sign = -1;
            }
            lexState = "sign";
            return;
          case ".":
            buffer = read();
            lexState = "decimalPointLeading";
            return;
          case "0":
            buffer = read();
            lexState = "zero";
            return;
          case "1":
          case "2":
          case "3":
          case "4":
          case "5":
          case "6":
          case "7":
          case "8":
          case "9":
            buffer = read();
            lexState = "decimalInteger";
            return;
          case "I":
            read();
            literal("nfinity");
            return newToken("numeric", Infinity);
          case "N":
            read();
            literal("aN");
            return newToken("numeric", NaN);
          case '"':
          case "'":
            doubleQuote = read() === '"';
            buffer = "";
            lexState = "string";
            return;
        }
        throw invalidChar(read());
      },
      identifierNameStartEscape() {
        if (c !== "u") {
          throw invalidChar(read());
        }
        read();
        const u = unicodeEscape();
        switch (u) {
          case "$":
          case "_":
            break;
          default:
            if (!util.isIdStartChar(u)) {
              throw invalidIdentifier();
            }
            break;
        }
        buffer += u;
        lexState = "identifierName";
      },
      identifierName() {
        switch (c) {
          case "$":
          case "_":
          case "\u200C":
          case "\u200D":
            buffer += read();
            return;
          case "\\":
            read();
            lexState = "identifierNameEscape";
            return;
        }
        if (util.isIdContinueChar(c)) {
          buffer += read();
          return;
        }
        return newToken("identifier", buffer);
      },
      identifierNameEscape() {
        if (c !== "u") {
          throw invalidChar(read());
        }
        read();
        const u = unicodeEscape();
        switch (u) {
          case "$":
          case "_":
          case "\u200C":
          case "\u200D":
            break;
          default:
            if (!util.isIdContinueChar(u)) {
              throw invalidIdentifier();
            }
            break;
        }
        buffer += u;
        lexState = "identifierName";
      },
      sign() {
        switch (c) {
          case ".":
            buffer = read();
            lexState = "decimalPointLeading";
            return;
          case "0":
            buffer = read();
            lexState = "zero";
            return;
          case "1":
          case "2":
          case "3":
          case "4":
          case "5":
          case "6":
          case "7":
          case "8":
          case "9":
            buffer = read();
            lexState = "decimalInteger";
            return;
          case "I":
            read();
            literal("nfinity");
            return newToken("numeric", sign * Infinity);
          case "N":
            read();
            literal("aN");
            return newToken("numeric", NaN);
        }
        throw invalidChar(read());
      },
      zero() {
        switch (c) {
          case ".":
            buffer += read();
            lexState = "decimalPoint";
            return;
          case "e":
          case "E":
            buffer += read();
            lexState = "decimalExponent";
            return;
          case "x":
          case "X":
            buffer += read();
            lexState = "hexadecimal";
            return;
        }
        return newToken("numeric", sign * 0);
      },
      decimalInteger() {
        switch (c) {
          case ".":
            buffer += read();
            lexState = "decimalPoint";
            return;
          case "e":
          case "E":
            buffer += read();
            lexState = "decimalExponent";
            return;
        }
        if (util.isDigit(c)) {
          buffer += read();
          return;
        }
        return newToken("numeric", sign * Number(buffer));
      },
      decimalPointLeading() {
        if (util.isDigit(c)) {
          buffer += read();
          lexState = "decimalFraction";
          return;
        }
        throw invalidChar(read());
      },
      decimalPoint() {
        switch (c) {
          case "e":
          case "E":
            buffer += read();
            lexState = "decimalExponent";
            return;
        }
        if (util.isDigit(c)) {
          buffer += read();
          lexState = "decimalFraction";
          return;
        }
        return newToken("numeric", sign * Number(buffer));
      },
      decimalFraction() {
        switch (c) {
          case "e":
          case "E":
            buffer += read();
            lexState = "decimalExponent";
            return;
        }
        if (util.isDigit(c)) {
          buffer += read();
          return;
        }
        return newToken("numeric", sign * Number(buffer));
      },
      decimalExponent() {
        switch (c) {
          case "+":
          case "-":
            buffer += read();
            lexState = "decimalExponentSign";
            return;
        }
        if (util.isDigit(c)) {
          buffer += read();
          lexState = "decimalExponentInteger";
          return;
        }
        throw invalidChar(read());
      },
      decimalExponentSign() {
        if (util.isDigit(c)) {
          buffer += read();
          lexState = "decimalExponentInteger";
          return;
        }
        throw invalidChar(read());
      },
      decimalExponentInteger() {
        if (util.isDigit(c)) {
          buffer += read();
          return;
        }
        return newToken("numeric", sign * Number(buffer));
      },
      hexadecimal() {
        if (util.isHexDigit(c)) {
          buffer += read();
          lexState = "hexadecimalInteger";
          return;
        }
        throw invalidChar(read());
      },
      hexadecimalInteger() {
        if (util.isHexDigit(c)) {
          buffer += read();
          return;
        }
        return newToken("numeric", sign * Number(buffer));
      },
      string() {
        switch (c) {
          case "\\":
            read();
            buffer += escape();
            return;
          case '"':
            if (doubleQuote) {
              read();
              return newToken("string", buffer);
            }
            buffer += read();
            return;
          case "'":
            if (!doubleQuote) {
              read();
              return newToken("string", buffer);
            }
            buffer += read();
            return;
          case "\n":
          case "\r":
            throw invalidChar(read());
          case "\u2028":
          case "\u2029":
            separatorChar(c);
            break;
          case void 0:
            throw invalidChar(read());
        }
        buffer += read();
      },
      start() {
        switch (c) {
          case "{":
          case "[":
            return newToken("punctuator", read());
        }
        lexState = "value";
      },
      beforePropertyName() {
        switch (c) {
          case "$":
          case "_":
            buffer = read();
            lexState = "identifierName";
            return;
          case "\\":
            read();
            lexState = "identifierNameStartEscape";
            return;
          case "}":
            return newToken("punctuator", read());
          case '"':
          case "'":
            doubleQuote = read() === '"';
            lexState = "string";
            return;
        }
        if (util.isIdStartChar(c)) {
          buffer += read();
          lexState = "identifierName";
          return;
        }
        throw invalidChar(read());
      },
      afterPropertyName() {
        if (c === ":") {
          return newToken("punctuator", read());
        }
        throw invalidChar(read());
      },
      beforePropertyValue() {
        lexState = "value";
      },
      afterPropertyValue() {
        switch (c) {
          case ",":
          case "}":
            return newToken("punctuator", read());
        }
        throw invalidChar(read());
      },
      beforeArrayValue() {
        if (c === "]") {
          return newToken("punctuator", read());
        }
        lexState = "value";
      },
      afterArrayValue() {
        switch (c) {
          case ",":
          case "]":
            return newToken("punctuator", read());
        }
        throw invalidChar(read());
      },
      end() {
        throw invalidChar(read());
      }
    };
    function newToken(type, value) {
      return {
        type,
        value,
        line,
        column
      };
    }
    function literal(s) {
      for (const c2 of s) {
        const p = peek();
        if (p !== c2) {
          throw invalidChar(read());
        }
        read();
      }
    }
    function escape() {
      const c2 = peek();
      switch (c2) {
        case "b":
          read();
          return "\b";
        case "f":
          read();
          return "\f";
        case "n":
          read();
          return "\n";
        case "r":
          read();
          return "\r";
        case "t":
          read();
          return "	";
        case "v":
          read();
          return "\v";
        case "0":
          read();
          if (util.isDigit(peek())) {
            throw invalidChar(read());
          }
          return "\0";
        case "x":
          read();
          return hexEscape();
        case "u":
          read();
          return unicodeEscape();
        case "\n":
        case "\u2028":
        case "\u2029":
          read();
          return "";
        case "\r":
          read();
          if (peek() === "\n") {
            read();
          }
          return "";
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9":
          throw invalidChar(read());
        case void 0:
          throw invalidChar(read());
      }
      return read();
    }
    function hexEscape() {
      let buffer2 = "";
      let c2 = peek();
      if (!util.isHexDigit(c2)) {
        throw invalidChar(read());
      }
      buffer2 += read();
      c2 = peek();
      if (!util.isHexDigit(c2)) {
        throw invalidChar(read());
      }
      buffer2 += read();
      return String.fromCodePoint(parseInt(buffer2, 16));
    }
    function unicodeEscape() {
      let buffer2 = "";
      let count = 4;
      while (count-- > 0) {
        const c2 = peek();
        if (!util.isHexDigit(c2)) {
          throw invalidChar(read());
        }
        buffer2 += read();
      }
      return String.fromCodePoint(parseInt(buffer2, 16));
    }
    var parseStates = {
      start() {
        if (token.type === "eof") {
          throw invalidEOF();
        }
        push();
      },
      beforePropertyName() {
        switch (token.type) {
          case "identifier":
          case "string":
            key = token.value;
            parseState = "afterPropertyName";
            return;
          case "punctuator":
            pop();
            return;
          case "eof":
            throw invalidEOF();
        }
      },
      afterPropertyName() {
        if (token.type === "eof") {
          throw invalidEOF();
        }
        parseState = "beforePropertyValue";
      },
      beforePropertyValue() {
        if (token.type === "eof") {
          throw invalidEOF();
        }
        push();
      },
      beforeArrayValue() {
        if (token.type === "eof") {
          throw invalidEOF();
        }
        if (token.type === "punctuator" && token.value === "]") {
          pop();
          return;
        }
        push();
      },
      afterPropertyValue() {
        if (token.type === "eof") {
          throw invalidEOF();
        }
        switch (token.value) {
          case ",":
            parseState = "beforePropertyName";
            return;
          case "}":
            pop();
        }
      },
      afterArrayValue() {
        if (token.type === "eof") {
          throw invalidEOF();
        }
        switch (token.value) {
          case ",":
            parseState = "beforeArrayValue";
            return;
          case "]":
            pop();
        }
      },
      end() {
      }
    };
    function push() {
      let value;
      switch (token.type) {
        case "punctuator":
          switch (token.value) {
            case "{":
              value = {};
              break;
            case "[":
              value = [];
              break;
          }
          break;
        case "null":
        case "boolean":
        case "numeric":
        case "string":
          value = token.value;
          break;
      }
      if (root === void 0) {
        root = value;
      } else {
        const parent = stack[stack.length - 1];
        if (Array.isArray(parent)) {
          parent.push(value);
        } else {
          Object.defineProperty(parent, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      if (value !== null && typeof value === "object") {
        stack.push(value);
        if (Array.isArray(value)) {
          parseState = "beforeArrayValue";
        } else {
          parseState = "beforePropertyName";
        }
      } else {
        const current = stack[stack.length - 1];
        if (current == null) {
          parseState = "end";
        } else if (Array.isArray(current)) {
          parseState = "afterArrayValue";
        } else {
          parseState = "afterPropertyValue";
        }
      }
    }
    function pop() {
      stack.pop();
      const current = stack[stack.length - 1];
      if (current == null) {
        parseState = "end";
      } else if (Array.isArray(current)) {
        parseState = "afterArrayValue";
      } else {
        parseState = "afterPropertyValue";
      }
    }
    function invalidChar(c2) {
      if (c2 === void 0) {
        return syntaxError(`JSON5: invalid end of input at ${line}:${column}`);
      }
      return syntaxError(`JSON5: invalid character '${formatChar(c2)}' at ${line}:${column}`);
    }
    function invalidEOF() {
      return syntaxError(`JSON5: invalid end of input at ${line}:${column}`);
    }
    function invalidIdentifier() {
      column -= 5;
      return syntaxError(`JSON5: invalid identifier character at ${line}:${column}`);
    }
    function separatorChar(c2) {
      console.warn(`JSON5: '${formatChar(c2)}' in strings is not valid ECMAScript; consider escaping`);
    }
    function formatChar(c2) {
      const replacements = {
        "'": "\\'",
        '"': '\\"',
        "\\": "\\\\",
        "\b": "\\b",
        "\f": "\\f",
        "\n": "\\n",
        "\r": "\\r",
        "	": "\\t",
        "\v": "\\v",
        "\0": "\\0",
        "\u2028": "\\u2028",
        "\u2029": "\\u2029"
      };
      if (replacements[c2]) {
        return replacements[c2];
      }
      if (c2 < " ") {
        const hexString = c2.charCodeAt(0).toString(16);
        return "\\x" + ("00" + hexString).substring(hexString.length);
      }
      return c2;
    }
    function syntaxError(message) {
      const err = new SyntaxError(message);
      err.lineNumber = line;
      err.columnNumber = column;
      return err;
    }
  }
});

// node_modules/json5/lib/stringify.js
var require_stringify = __commonJS({
  "node_modules/json5/lib/stringify.js"(exports2, module2) {
    var util = require_util();
    module2.exports = function stringify(value, replacer, space) {
      const stack = [];
      let indent = "";
      let propertyList;
      let replacerFunc;
      let gap = "";
      let quote;
      if (replacer != null && typeof replacer === "object" && !Array.isArray(replacer)) {
        space = replacer.space;
        quote = replacer.quote;
        replacer = replacer.replacer;
      }
      if (typeof replacer === "function") {
        replacerFunc = replacer;
      } else if (Array.isArray(replacer)) {
        propertyList = [];
        for (const v of replacer) {
          let item;
          if (typeof v === "string") {
            item = v;
          } else if (typeof v === "number" || v instanceof String || v instanceof Number) {
            item = String(v);
          }
          if (item !== void 0 && propertyList.indexOf(item) < 0) {
            propertyList.push(item);
          }
        }
      }
      if (space instanceof Number) {
        space = Number(space);
      } else if (space instanceof String) {
        space = String(space);
      }
      if (typeof space === "number") {
        if (space > 0) {
          space = Math.min(10, Math.floor(space));
          gap = "          ".substr(0, space);
        }
      } else if (typeof space === "string") {
        gap = space.substr(0, 10);
      }
      return serializeProperty("", { "": value });
      function serializeProperty(key, holder) {
        let value2 = holder[key];
        if (value2 != null) {
          if (typeof value2.toJSON5 === "function") {
            value2 = value2.toJSON5(key);
          } else if (typeof value2.toJSON === "function") {
            value2 = value2.toJSON(key);
          }
        }
        if (replacerFunc) {
          value2 = replacerFunc.call(holder, key, value2);
        }
        if (value2 instanceof Number) {
          value2 = Number(value2);
        } else if (value2 instanceof String) {
          value2 = String(value2);
        } else if (value2 instanceof Boolean) {
          value2 = value2.valueOf();
        }
        switch (value2) {
          case null:
            return "null";
          case true:
            return "true";
          case false:
            return "false";
        }
        if (typeof value2 === "string") {
          return quoteString(value2, false);
        }
        if (typeof value2 === "number") {
          return String(value2);
        }
        if (typeof value2 === "object") {
          return Array.isArray(value2) ? serializeArray(value2) : serializeObject(value2);
        }
        return void 0;
      }
      function quoteString(value2) {
        const quotes = {
          "'": 0.1,
          '"': 0.2
        };
        const replacements = {
          "'": "\\'",
          '"': '\\"',
          "\\": "\\\\",
          "\b": "\\b",
          "\f": "\\f",
          "\n": "\\n",
          "\r": "\\r",
          "	": "\\t",
          "\v": "\\v",
          "\0": "\\0",
          "\u2028": "\\u2028",
          "\u2029": "\\u2029"
        };
        let product = "";
        for (let i = 0; i < value2.length; i++) {
          const c = value2[i];
          switch (c) {
            case "'":
            case '"':
              quotes[c]++;
              product += c;
              continue;
            case "\0":
              if (util.isDigit(value2[i + 1])) {
                product += "\\x00";
                continue;
              }
          }
          if (replacements[c]) {
            product += replacements[c];
            continue;
          }
          if (c < " ") {
            let hexString = c.charCodeAt(0).toString(16);
            product += "\\x" + ("00" + hexString).substring(hexString.length);
            continue;
          }
          product += c;
        }
        const quoteChar = quote || Object.keys(quotes).reduce((a, b) => quotes[a] < quotes[b] ? a : b);
        product = product.replace(new RegExp(quoteChar, "g"), replacements[quoteChar]);
        return quoteChar + product + quoteChar;
      }
      function serializeObject(value2) {
        if (stack.indexOf(value2) >= 0) {
          throw TypeError("Converting circular structure to JSON5");
        }
        stack.push(value2);
        let stepback = indent;
        indent = indent + gap;
        let keys = propertyList || Object.keys(value2);
        let partial = [];
        for (const key of keys) {
          const propertyString = serializeProperty(key, value2);
          if (propertyString !== void 0) {
            let member = serializeKey(key) + ":";
            if (gap !== "") {
              member += " ";
            }
            member += propertyString;
            partial.push(member);
          }
        }
        let final;
        if (partial.length === 0) {
          final = "{}";
        } else {
          let properties;
          if (gap === "") {
            properties = partial.join(",");
            final = "{" + properties + "}";
          } else {
            let separator = ",\n" + indent;
            properties = partial.join(separator);
            final = "{\n" + indent + properties + ",\n" + stepback + "}";
          }
        }
        stack.pop();
        indent = stepback;
        return final;
      }
      function serializeKey(key) {
        if (key.length === 0) {
          return quoteString(key, true);
        }
        const firstChar = String.fromCodePoint(key.codePointAt(0));
        if (!util.isIdStartChar(firstChar)) {
          return quoteString(key, true);
        }
        for (let i = firstChar.length; i < key.length; i++) {
          if (!util.isIdContinueChar(String.fromCodePoint(key.codePointAt(i)))) {
            return quoteString(key, true);
          }
        }
        return key;
      }
      function serializeArray(value2) {
        if (stack.indexOf(value2) >= 0) {
          throw TypeError("Converting circular structure to JSON5");
        }
        stack.push(value2);
        let stepback = indent;
        indent = indent + gap;
        let partial = [];
        for (let i = 0; i < value2.length; i++) {
          const propertyString = serializeProperty(String(i), value2);
          partial.push(propertyString !== void 0 ? propertyString : "null");
        }
        let final;
        if (partial.length === 0) {
          final = "[]";
        } else {
          if (gap === "") {
            let properties = partial.join(",");
            final = "[" + properties + "]";
          } else {
            let separator = ",\n" + indent;
            let properties = partial.join(separator);
            final = "[\n" + indent + properties + ",\n" + stepback + "]";
          }
        }
        stack.pop();
        indent = stepback;
        return final;
      }
    };
  }
});

// node_modules/json5/lib/index.js
var require_lib = __commonJS({
  "node_modules/json5/lib/index.js"(exports2, module2) {
    var parse = require_parse();
    var stringify = require_stringify();
    var JSON52 = {
      parse,
      stringify
    };
    module2.exports = JSON52;
  }
});

// lib/runner-v2/chain-graph-cli.ts
var chain_graph_cli_exports = {};
__export(chain_graph_cli_exports, {
  renderChainGraph: () => renderChainGraph,
  runChainGraphCli: () => runChainGraphCli
});
module.exports = __toCommonJS(chain_graph_cli_exports);

// lib/config.ts
var import_path = __toESM(require("path"));
var import_os = require("os");

// config/agent-provider-catalog.json
var agent_provider_catalog_default = {
  cliTools: [
    {
      id: "claude",
      name: "Claude Code",
      cli: "claude",
      description: "Anthropic Claude CLI - most capable",
      iconKey: "claude",
      color: "text-amber-400",
      badgeColor: "text-amber-300",
      badgeBg: "bg-amber-500/20",
      credentialKey: "claude",
      bundleProvider: "claude-code",
      terminalAuthCommand: "claude auth login",
      interactiveAuthCommand: "claude auth login",
      detectable: true
    },
    {
      id: "codex",
      name: "Codex",
      cli: "codex",
      description: "OpenAI Codex - code generation",
      iconKey: "openai",
      color: "text-emerald-400",
      badgeColor: "text-emerald-300",
      badgeBg: "bg-emerald-500/20",
      credentialKey: "codex",
      bundleProvider: "codex",
      terminalAuthCommand: "codex login --device-auth",
      interactiveAuthCommand: "codex login --device-auth",
      detectable: true
    },
    {
      id: "aider",
      name: "Aider",
      cli: "aider",
      description: "Aider - AI pair programming",
      iconKey: "aider",
      color: "text-indigo-400",
      badgeColor: "text-indigo-300",
      badgeBg: "bg-indigo-500/20",
      terminalAuthCommand: "aider --help",
      detectable: true
    },
    {
      id: "antigravity",
      name: "Antigravity CLI",
      cli: "agy",
      description: "Google Antigravity CLI - terminal agent harness",
      iconKey: "antigravity",
      color: "text-blue-400",
      badgeColor: "text-blue-300",
      badgeBg: "bg-blue-500/20",
      credentialKey: "gemini",
      bundleProvider: "antigravity",
      terminalAuthCommand: "agy",
      interactiveAuthCommand: "agy",
      detectable: true
    },
    {
      id: "kollab",
      name: "Kollab",
      cli: "kollab",
      description: "Kollab - collaborative AI",
      iconKey: "kollab",
      color: "text-purple-400",
      badgeColor: "text-purple-300",
      badgeBg: "bg-purple-500/20",
      credentialKey: "kollab",
      bundleProvider: "kollab",
      terminalAuthCommand: "kollab --login openai",
      detectable: true
    },
    {
      id: "opencode",
      name: "OpenCode",
      cli: "opencode",
      description: "OpenCode - multi-provider coding runner",
      iconKey: "openai",
      color: "text-indigo-400",
      badgeColor: "text-indigo-300",
      badgeBg: "bg-indigo-500/20",
      credentialKey: "opencode",
      bundleProvider: "opencode",
      terminalAuthCommand: "opencode auth login",
      detectable: false
    }
  ],
  providerCredentials: {
    claude: {
      envKey: "ANTHROPIC_AUTH_TOKEN",
      label: "Anthropic API Key",
      placeholder: "sk-ant-...",
      docsUrl: "https://console.anthropic.com/settings/keys",
      docsLabel: "Get API key"
    },
    gemini: {
      envKey: "GEMINI_API_KEY",
      label: "Google Gemini API Key",
      placeholder: "AIza...",
      docsUrl: "https://aistudio.google.com/app/apikey",
      docsLabel: "Get API key"
    },
    codex: {
      envKey: "OPENAI_API_KEY",
      label: "OpenAI API Key",
      placeholder: "sk-...",
      docsUrl: "https://platform.openai.com/api-keys",
      docsLabel: "Get API key"
    },
    opencode: {
      envKey: "OPENAI_API_KEY",
      label: "OpenAI API Key",
      placeholder: "sk-...",
      docsUrl: "https://platform.openai.com/api-keys",
      docsLabel: "Get API key"
    },
    kollab: {
      envKey: "KOLLAB_API_KEY",
      label: "Kollab API Key",
      placeholder: "sk-...",
      docsUrl: "https://github.com/kollaborai/kollab#readme",
      docsLabel: "Kollab auth docs"
    }
  },
  secretPresets: [
    { label: "Anthropic API Key", envVar: "ANTHROPIC_AUTH_TOKEN" },
    { label: "OpenAI API Key", envVar: "OPENAI_API_KEY" },
    { label: "Google Gemini API Key", envVar: "GEMINI_API_KEY" },
    { label: "Kollab API Key", envVar: "KOLLAB_API_KEY" },
    { label: "GitHub Token", envVar: "GITHUB_TOKEN" },
    { label: "Custom", envVar: "" }
  ],
  profileBundles: [
    {
      provider: "claude-code",
      name: "Claude Code",
      logoKey: "claude-code",
      log_path: "~/.claude/projects/",
      log_format: "jsonl",
      profiles: [
        {
          id: "claude-sonnet",
          name: "Claude / Sonnet",
          cli: "claude",
          model: "sonnet",
          pipe_flag: "-p",
          permission_flag: "--dangerously-skip-permissions",
          pre_exec: "unset CLAUDECODE",
          readiness: { enabled: true, ready_patterns: [{ name: "claude input-ready hint", type: "text", value: "for agents", action: "ready", risk: "low", enabled: true }] },
          description: "Balanced performance - always latest Sonnet"
        },
        {
          id: "claude-opus",
          name: "Claude / Opus",
          cli: "claude",
          model: "opus",
          pipe_flag: "-p",
          permission_flag: "--dangerously-skip-permissions",
          pre_exec: "unset CLAUDECODE",
          readiness: { enabled: true, ready_patterns: [{ name: "claude input-ready hint", type: "text", value: "for agents", action: "ready", risk: "low", enabled: true }] },
          description: "Highest capability - always latest Opus"
        },
        {
          id: "claude-haiku",
          name: "Claude / Haiku",
          cli: "claude",
          model: "haiku",
          pipe_flag: "-p",
          permission_flag: "--dangerously-skip-permissions",
          pre_exec: "unset CLAUDECODE",
          readiness: { enabled: true, ready_patterns: [{ name: "claude input-ready hint", type: "text", value: "for agents", action: "ready", risk: "low", enabled: true }] },
          description: "Fastest for simple tasks - always latest Haiku"
        }
      ]
    },
    {
      provider: "codex",
      name: "Codex",
      logoKey: "codex",
      log_path: "~/.codex/sessions/",
      log_format: "jsonl",
      profiles: [
        {
          id: "codex-default",
          name: "Codex / GPT-5.5",
          cli: "codex",
          model: "gpt-5.5",
          pipe_flag: "exec",
          permission_flag: "--dangerously-bypass-approvals-and-sandbox",
          readiness: {
            enabled: true,
            ready_patterns: [{ name: "codex tui banner", type: "text", value: "OpenAI Codex (v", action: "ready", risk: "low", enabled: true }, { name: "codex input placeholder", type: "text", value: "Find and fix a bug", action: "ready", risk: "low", enabled: true }],
            blocked_patterns: [
              {
                name: "unsupported skip git repo check arg",
                type: "text",
                value: "unexpected argument '--skip-git-repo-check'",
                action: "block",
                risk: "low",
                enabled: true
              }
            ],
            retry_patterns: [
              {
                name: "cli install or update in progress",
                type: "regex",
                value: "(installing|updating|downloading)",
                action: "retry",
                risk: "medium",
                enabled: true
              }
            ],
            recoverable_patterns: [
              {
                name: "press enter to continue",
                type: "regex",
                value: "Press Enter to continue",
                action: "recover",
                risk: "low",
                enabled: true
              }
            ]
          },
          description: "Flagship model for complex coding and agentic work"
        },
        {
          id: "codex-fast",
          name: "Codex / GPT-5.4 mini",
          cli: "codex",
          model: "gpt-5.4-mini",
          pipe_flag: "exec",
          permission_flag: "--dangerously-bypass-approvals-and-sandbox",
          readiness: {
            enabled: true,
            ready_patterns: [{ name: "codex tui banner", type: "text", value: "OpenAI Codex (v", action: "ready", risk: "low", enabled: true }, { name: "codex input placeholder", type: "text", value: "Find and fix a bug", action: "ready", risk: "low", enabled: true }],
            blocked_patterns: [
              {
                name: "unsupported skip git repo check arg",
                type: "text",
                value: "unexpected argument '--skip-git-repo-check'",
                action: "block",
                risk: "low",
                enabled: true
              }
            ],
            retry_patterns: [
              {
                name: "cli install or update in progress",
                type: "regex",
                value: "(installing|updating|downloading)",
                action: "retry",
                risk: "medium",
                enabled: true
              }
            ],
            recoverable_patterns: [
              {
                name: "press enter to continue",
                type: "regex",
                value: "Press Enter to continue",
                action: "recover",
                risk: "low",
                enabled: true
              }
            ]
          },
          description: "Faster, lower-cost Codex profile for focused tasks"
        }
      ]
    },
    {
      provider: "opencode",
      name: "OpenCode",
      logoKey: "opencode",
      log_path: "~/.config/opencode/",
      log_format: "sqlite",
      profiles: [
        {
          id: "opencode-sonnet",
          name: "OpenCode / Sonnet 4.6",
          cli: "opencode",
          model: "anthropic/claude-sonnet-4-6",
          pipe_flag: "-p",
          readiness: { enabled: true, ready_patterns: [{ name: "opencode input ready", type: "text", value: "Ask anything", action: "ready", risk: "low", enabled: true }, { name: "opencode command hint", type: "text", value: "ctrl+p commands", action: "ready", risk: "low", enabled: true }] },
          description: "Claude Sonnet 4.6 via OpenCode runner"
        },
        {
          id: "opencode-gpt",
          name: "OpenCode / GPT-5.5",
          cli: "opencode",
          model: "openai/gpt-5.5",
          pipe_flag: "-p",
          readiness: { enabled: true, ready_patterns: [{ name: "opencode input ready", type: "text", value: "Ask anything", action: "ready", risk: "low", enabled: true }, { name: "opencode command hint", type: "text", value: "ctrl+p commands", action: "ready", risk: "low", enabled: true }] },
          description: "OpenAI GPT-5.5 via OpenCode runner"
        }
      ]
    },
    {
      provider: "kollab",
      name: "Kollab",
      logoKey: "kollab",
      log_path: "~/.kollab/projects/",
      log_format: "jsonl",
      profiles: [
        {
          id: "kollab",
          name: "Kollab / Mentiko",
          cli: "kollab",
          pipe_flag: "-p",
          permission_flag: "--permissions trust",
          preferredAdvisorDefault: true,
          readiness: { enabled: true, ready_patterns: [{ name: "kollab ready line", type: "text", value: "ready \xB7", action: "ready", risk: "low", enabled: true }, { name: "kollab hooks active", type: "text", value: "hooks active", action: "ready", risk: "low", enabled: true }] },
          description: "Kollab / Mentiko"
        }
      ]
    },
    {
      provider: "antigravity",
      name: "Antigravity CLI",
      logoKey: "antigravity",
      log_path: "~/.gemini/antigravity-cli/",
      log_format: "json",
      profiles: [
        {
          id: "antigravity-default",
          name: "Antigravity / CLI Default",
          cli: "agy",
          permission_flag: "--dangerously-skip-permissions",
          description: "Uses the Antigravity CLI default model and settings"
        }
      ]
    },
    {
      provider: "custom",
      name: "Custom",
      logoKey: "custom",
      profiles: []
    }
  ],
  legacyProfileReplacements: [
    {
      provider: "codex",
      profile: {
        id: "codex-spark",
        name: "Codex / Spark",
        cli: "codex",
        model: "gpt-5.4-mini",
        pipe_flag: "exec",
        permission_flag: "--dangerously-bypass-approvals-and-sandbox",
        readiness: {
          enabled: true,
          blocked_patterns: [
            {
              name: "unsupported skip git repo check arg",
              type: "text",
              value: "unexpected argument '--skip-git-repo-check'",
              action: "block",
              risk: "low",
              enabled: true
            }
          ],
          retry_patterns: [
            {
              name: "cli install or update in progress",
              type: "regex",
              value: "(installing|updating|downloading)",
              action: "retry",
              risk: "medium",
              enabled: true
            }
          ],
          recoverable_patterns: [
            {
              name: "press enter to continue",
              type: "regex",
              value: "Press Enter to continue",
              action: "recover",
              risk: "low",
              enabled: true
            }
          ]
        },
        description: "Legacy Spark profile id synced to the current fast Codex model"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-flash",
        name: "Antigravity / Gemini Flash Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Flash profile id synced to Antigravity CLI defaults"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-pro-preview",
        name: "Antigravity / Gemini Pro Preview Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Pro preview profile id synced to Antigravity CLI defaults"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-flash-lite",
        name: "Antigravity / Gemini Flash-Lite Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Flash-Lite profile id synced to Antigravity CLI defaults"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-pro",
        name: "Antigravity / Gemini Pro Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Pro profile id synced to Antigravity CLI defaults"
      }
    }
  ],
  engineProviders: [
    {
      value: "anthropic",
      label: "Anthropic",
      model: "claude-sonnet-4-6",
      baseUrl: "",
      iconKey: "claude"
    },
    {
      value: "openai",
      label: "OpenAI",
      model: "gpt-5.5",
      baseUrl: "",
      iconKey: "openai"
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      model: "deepseek/deepseek-v4-flash",
      baseUrl: "https://openrouter.ai/api/v1",
      iconKey: "openrouter"
    },
    {
      value: "gemini",
      label: "Google Gemini",
      model: "gemini-3.5-flash",
      baseUrl: "",
      iconKey: "gemini"
    },
    {
      value: "custom",
      label: "Custom / Local",
      model: "",
      baseUrl: "",
      iconKey: "custom"
    },
    {
      value: "auto",
      label: "Auto (env vars)",
      model: "",
      baseUrl: "",
      iconKey: "custom"
    }
  ],
  mentikoGatewayProfile: {
    name: "mentiko",
    provider: "openai",
    model: "glm-5.1",
    description: "Mentiko AI gateway (included AI)"
  },
  runtimeDefaults: {
    marketplaceAgentModel: "claude-sonnet-4-6",
    costModel: "claude-sonnet-4-6",
    linkEscalationModel: "haiku",
    codexInlineAuthModel: "gpt-5.5"
  }
};

// lib/agents/agent-provider-catalog.ts
var catalog = agent_provider_catalog_default;
var CLI_TOOLS = catalog.cliTools;
var PROVIDER_CREDENTIALS = catalog.providerCredentials;
var COMMON_PRESETS = catalog.secretPresets;
var PROFILE_BUNDLES = catalog.profileBundles;
var LEGACY_PROFILE_REPLACEMENTS = catalog.legacyProfileReplacements;
var ENGINE_PROVIDER_DEFAULTS = catalog.engineProviders;
var MENTIKO_GATEWAY_PROFILE = catalog.mentikoGatewayProfile;
var DEFAULT_MARKETPLACE_AGENT_MODEL = catalog.runtimeDefaults.marketplaceAgentModel;
var DEFAULT_COST_MODEL = catalog.runtimeDefaults.costModel;
var LINK_ESCALATION_FALLBACK_MODEL = catalog.runtimeDefaults.linkEscalationModel;
var CODEX_INLINE_AUTH_MODEL = catalog.runtimeDefaults.codexInlineAuthModel;

// lib/agents/provider-bundles.ts
var CLAUDE_CODE_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cc-grad" x1="0" y1="0" x2="32" y2="32">
      <stop offset="0%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#dc2626" />
    </linearGradient>
  </defs>
  <path d="M16 2L28 9v14l-12 7-12-7V9z" fill="url(#cc-grad)" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">CC</text>
</svg>`;
var CODEX_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="24" height="24" rx="4" fill="#10b981" />
  <text x="16" y="22" font-family="monospace" font-size="14" font-weight="bold" fill="white" text-anchor="middle">C</text>
</svg>`;
var OPENCODE_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="12" fill="#3b82f6" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">O</text>
</svg>`;
var KOLLAB_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 2L28 9v14l-12 7-12-7V9z" fill="#8b5cf6" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">K</text>
</svg>`;
var ANTIGRAVITY_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="antigravity-grad" x1="0" y1="0" x2="32" y2="32">
      <stop offset="0%" stop-color="#4285f4" />
      <stop offset="100%" stop-color="#9c5cf6" />
    </linearGradient>
  </defs>
  <path d="M16 2 C17 10 22 11 30 16 C22 21 17 22 16 30 C15 22 10 21 2 16 C10 11 15 10 16 2 Z" fill="url(#antigravity-grad)"/>
  <text x="16" y="20" font-family="monospace" font-size="7" font-weight="bold" fill="white" text-anchor="middle">AG</text>
</svg>`;
var CUSTOM_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="10" stroke="#6b7280" stroke-width="3" fill="none" />
  <circle cx="16" cy="16" r="4" fill="#6b7280" />
</svg>`;
var LOGOS = {
  "claude-code": CLAUDE_CODE_LOGO,
  codex: CODEX_LOGO,
  opencode: OPENCODE_LOGO,
  kollab: KOLLAB_LOGO,
  antigravity: ANTIGRAVITY_LOGO,
  custom: CUSTOM_LOGO
};
var PROVIDER_BUNDLES = PROFILE_BUNDLES.map((bundle) => ({
  ...bundle,
  logo: LOGOS[bundle.logoKey] ?? CUSTOM_LOGO
}));

// lib/config.ts
function expandTilde(p) {
  if (p.startsWith("~/") || p === "~") {
    return import_path.default.join((0, import_os.homedir)(), p.slice(2));
  }
  return p;
}
function slugPart(value) {
  const slug = value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || "root";
}
function derivePtyDaemonName(root, namespace, org) {
  return [
    "mentiko",
    slugPart(root),
    slugPart(namespace || "default"),
    slugPart(org || "default")
  ].join("-");
}
function encodeProjectPath(dir) {
  return dir.replace(/\//g, "-");
}
var globalRoot = expandTilde(
  process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || import_path.default.join((0, import_os.homedir)(), ".mentiko")
);
var codeRoot = process.env.MENTIKO_CODE_ROOT || import_path.default.resolve(process.cwd(), "..");
var namespaceId = process.env.NAMESPACE_ID || "default";
var orgId = process.env.ORG_ID || "default";
var ptyDaemonName = process.env.PTY_DAEMON || derivePtyDaemonName(globalRoot, namespaceId, orgId);
process.env.PTY_DAEMON = ptyDaemonName;
var projectDir = process.env.MENTIKO_PROJECT_DIR || codeRoot;
var projectId = encodeProjectPath(projectDir);
var namespaceRoot = process.env.MENTIKO_NAMESPACE_ROOT || import_path.default.join(globalRoot, "namespaces", namespaceId);
var orgRoot = process.env.MENTIKO_ORG_ROOT || (orgId === "default" ? namespaceRoot : import_path.default.join(namespaceRoot, "orgs", orgId));
var projectRoot = process.env.MENTIKO_PROJECT_ROOT || (projectDir === codeRoot ? orgRoot : import_path.default.join(orgRoot, "projects", projectId));
var claudeProjectsBase = process.env.CLAUDE_PROJECTS_DIR || import_path.default.join((0, import_os.homedir)(), ".claude", "projects");
var ptyManagerDir = process.env.PTY_MANAGER_DIR || import_path.default.join((0, import_os.homedir)(), ".pty-manager");
var demoWorkspaceDir = process.env.DEMO_WORKSPACE_DIR || import_path.default.join(globalRoot, "demo-workspace");
var config = {
  // --- roots ---
  globalRoot,
  codeRoot,
  namespaceRoot,
  orgRoot,
  projectRoot,
  // --- IDs ---
  namespaceId,
  orgId,
  projectId,
  projectDir,
  // backward compat: root was used for code paths (bin, lib, scripts)
  root: codeRoot,
  // backward compat: namespacesBase used by some API routes
  namespacesBase: import_path.default.join(globalRoot, "namespaces"),
  // --- tier 1: global ---
  authDbPath: import_path.default.join(globalRoot, "data", "auth.db"),
  // --- tier 2: namespace ---
  billingDir: import_path.default.join(namespaceRoot, "billing"),
  namespaceSettingsDir: import_path.default.join(namespaceRoot, "settings"),
  marketplaceDir: import_path.default.join(namespaceRoot, "marketplace"),
  // --- tier 3: org ---
  chainsDir: process.env.CHAIN_DIR || import_path.default.join(orgRoot, "chains"),
  linksDir: process.env.LINKS_DIR || import_path.default.join(orgRoot, "links"),
  agentsDir: process.env.AGENTS_DIR || import_path.default.join(orgRoot, "agents"),
  agentProfilesDir: process.env.AGENT_PROFILES_DIR || import_path.default.join(orgRoot, "agent-profiles"),
  configProfilesDir: process.env.CONFIG_PROFILES_DIR || import_path.default.join(orgRoot, "config-profiles"),
  templatesDir: process.env.TEMPLATES_DIR || import_path.default.join(orgRoot, "templates"),
  webhooksDir: process.env.WEBHOOKS_DIR || import_path.default.join(orgRoot, "webhooks"),
  emailsDir: process.env.EMAILS_DIR || import_path.default.join(orgRoot, "emails"),
  // --- tier 4: project ---
  runsDir: process.env.RUNS_DIR || import_path.default.join(projectRoot, "runs"),
  jobsDir: process.env.JOBS_DIR || import_path.default.join(projectRoot, "jobs"),
  eventsDir: process.env.EVENTS_DIR || import_path.default.join(projectRoot, "events"),
  stateDir: process.env.STATE_DIR || import_path.default.join(projectRoot, "state"),
  decisionsDir: process.env.DECISIONS_DIR || import_path.default.join(projectRoot, "decisions"),
  schedulesDir: process.env.SCHEDULES_DIR || import_path.default.join(projectRoot, "schedules"),
  metricsDir: process.env.METRICS_DIR || import_path.default.join(projectRoot, "metrics"),
  notificationsDir: process.env.NOTIFICATIONS_DIR || import_path.default.join(projectRoot, "notifications"),
  reportsDir: process.env.REPORTS_DIR || import_path.default.join(projectRoot, "reports"),
  debugDir: process.env.DEBUG_DIR || import_path.default.join(projectRoot, "debug"),
  workspaceDir: process.env.WORKSPACE_DIR || import_path.default.join(projectRoot, "workspace"),
  profilesDir: process.env.PROFILES_DIR || import_path.default.join(projectRoot, "profiles"),
  watchdogHooksDir: process.env.WATCHDOG_HOOKS_DIR || import_path.default.join(projectRoot, "watchdog-hooks"),
  // --- code root (not data, these are executables/scripts) ---
  binDir: process.env.BIN_DIR || import_path.default.join(codeRoot, "bin"),
  libDir: process.env.LIB_DIR || import_path.default.join(codeRoot, "lib"),
  // --- external tool paths (system-level, not data) ---
  ptyManagerDir,
  ptySocketPath: process.env.PTY_SOCKET_PATH || null,
  ptyTokenPath: process.env.PTY_TOKEN_PATH || null,
  ptyDaemonName,
  demoWorkspaceDir,
  claudeProjectsDir: claudeProjectsBase,
  infraSshPublicKey: process.env.MENTIKO_SSH_PUBLIC_KEY || null,
  infraSshPrivateKey: process.env.MENTIKO_SSH_PRIVATE_KEY || null,
  // --- operational ---
  cliBin: process.env.CLI_BIN || "claude",
  sessionPrefix: process.env.SESSION_PREFIX || "mentiko",
  defaultMaxRounds: parseInt(process.env.DEFAULT_MAX_ROUNDS || "50", 10),
  polling: {
    sessions: parseInt(process.env.POLLING_SESSIONS || "3000", 10),
    output: parseInt(process.env.POLLING_OUTPUT || "2000", 10),
    conversations: parseInt(process.env.POLLING_CONVERSATIONS || "5000", 10),
    messages: parseInt(process.env.POLLING_MESSAGES || "3000", 10)
  }
};
var config_default = config;

// lib/runner-v2/chain-contract.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function asRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function readJson(path2) {
  try {
    return JSON.parse((0, import_node_fs.readFileSync)(path2, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read JSON ${path2}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function safeRefPath(agentsDir, reference) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(reference)) throw new Error(`Agent reference is not a safe id: ${reference}`);
  const candidates = [(0, import_node_path.join)(agentsDir, reference, "agent.json"), (0, import_node_path.join)(agentsDir, `${reference}.json`)];
  for (const candidate of candidates) {
    const resolvedRoot = (0, import_node_path.resolve)(agentsDir) + import_node_path.sep;
    if (!(0, import_node_path.resolve)(candidate).startsWith(resolvedRoot)) throw new Error(`Agent reference escapes agents directory: ${reference}`);
    try {
      (0, import_node_fs.readFileSync)(candidate);
      return candidate;
    } catch {
    }
  }
  throw new Error(`Agent reference not found: ${reference}`);
}
function normalizeChainDefinition(raw, agentsDir) {
  if (!Array.isArray(raw.agents)) throw new Error("chain.agents must be an array");
  const agents = raw.agents.map((value, index) => {
    const agent = asRecord(value, `agents[${index}]`);
    if (typeof agent.$ref !== "string" || !agent.$ref.trim()) return { ...agent };
    const base = asRecord(readJson(safeRefPath(agentsDir, agent.$ref)), `agent reference ${agent.$ref}`);
    const { $ref: _ref, ...overrides } = agent;
    return { ...base, ...overrides };
  });
  return { ...raw, agents };
}
function validateNormalizedChainDefinition(chain) {
  const branches = chain.branches;
  if (branches === void 0) return;
  const record = asRecord(branches, "chain.branches");
  for (const [event, target] of Object.entries(record)) {
    if (!target || typeof target !== "object" || Array.isArray(target)) continue;
    const branch = target;
    if (typeof branch.fan_in === "string" && Array.isArray(branch.fan_out) && branch.fan_out.some((candidate) => candidate === branch.fan_in)) {
      throw new Error(`branches.${event}: fan_in must not also appear in fan_out`);
    }
  }
}

// lib/runner-v2/chain-validation-cli.ts
var import_node_fs2 = require("node:fs");
var import_json5 = __toESM(require_lib());
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function readRawChainFile(path2) {
  if (!(0, import_node_fs2.existsSync)(path2)) throw new Error(`file not found: ${path2}`);
  const stat = (0, import_node_fs2.lstatSync)(path2);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`chain file must be a non-symlink regular file: ${path2}`);
  }
  const text = (0, import_node_fs2.readFileSync)(path2, "utf8");
  let parsed;
  try {
    parsed = import_json5.default.parse(text);
  } catch {
    throw new Error(`invalid JSON syntax in ${path2}`);
  }
  if (!isRecord(parsed)) throw new Error(`chain definition must be an object: ${path2}`);
  return { path: path2, text, value: parsed };
}
function agentIds(agents) {
  return agents.flatMap((agent) => nonEmptyString(agent.id) ? [agent.id] : []);
}
function duplicateValues(values) {
  const counts = /* @__PURE__ */ new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort();
}
function agentHasRequiredFields(agent) {
  return isRecord(agent) && nonEmptyString(agent.id) && nonEmptyString(agent.name) && Array.isArray(agent.triggers) && agent.triggers.every(nonEmptyString) && nonEmptyString(agent.emits);
}
function stringArray(value) {
  return Array.isArray(value) ? value.filter(nonEmptyString) : [];
}
function objectAt(value) {
  return isRecord(value) ? value : void 0;
}
function validateNormalizedChain(raw, strict) {
  const errors = [];
  const warnings = [];
  if (!nonEmptyString(raw.name)) errors.push("missing required field: name");
  if (!Array.isArray(raw.agents) || raw.agents.length === 0) errors.push("no agents defined");
  const agents = Array.isArray(raw.agents) ? raw.agents.filter(isRecord) : [];
  const duplicateIds = duplicateValues(agentIds(agents));
  if (duplicateIds.length > 0) {
    errors.push(`duplicate agent IDs found:
${duplicateIds.map((id) => `      ${id}`).join("\n")}`);
  }
  const invalidAgents = Array.isArray(raw.agents) ? raw.agents.filter((agent) => !agentHasRequiredFields(agent)) : [];
  if (invalidAgents.length > 0) {
    const names = invalidAgents.map((agent) => isRecord(agent) && nonEmptyString(agent.id) ? agent.id : "unnamed");
    errors.push(`agents missing required fields (id, name, triggers, emits):
${names.map((name) => `      ${name}`).join("\n")}`);
  }
  if (errors.length > 0) return { errors, warnings, lines: [] };
  const normalizedAgents = raw.agents;
  const lines = [
    "",
    "  schema valid",
    `  chain: ${raw.name}`,
    `    version: ${nonEmptyString(raw.version) ? raw.version : "1.0"}`,
    `    agents: ${normalizedAgents.length}`
  ];
  if (nonEmptyString(raw.description)) lines.push(`    description: ${raw.description}`);
  if (!strict) return { errors, warnings, lines };
  const emitted = normalizedAgents.map((agent) => agent.emits);
  const triggers = normalizedAgents.flatMap((agent) => stringArray(agent.triggers));
  const unresolved = [...new Set(triggers.filter((trigger) => trigger !== "manual-start" && !emitted.includes(trigger)))].sort();
  const unused = [...new Set(emitted.filter((emit) => !triggers.includes(emit)))].sort();
  lines.push("", "running strict validation...");
  if (unresolved.length > 0) {
    warnings.push(`warning: triggers with no matching emits:
${unresolved.map((trigger) => `      ${trigger}`).join("\n")}`);
  }
  if (unused.length > 0) {
    warnings.push(`warning: emits with no matching triggers:
${unused.map((emit) => `      ${emit}`).join("\n")}`);
  }
  if (unresolved.length === 0 && unused.length === 0) lines.push("  all triggers resolved");
  lines.push("", "checking agent configuration...");
  const noPrompt = normalizedAgents.filter((agent) => !nonEmptyString(agent.prompt) && !nonEmptyString(agent.spec)).map((agent) => agent.id);
  if (noPrompt.length > 0) {
    warnings.push(`warning: agents without prompt or spec:
${noPrompt.map((id) => `      ${id}`).join("\n")}`);
  }
  const config2 = objectAt(raw.config);
  const webhooks = objectAt(config2?.webhooks);
  if (webhooks?.enabled === true && stringArray(webhooks.urls).length === 0) {
    warnings.push("warning: webhooks enabled but no URLs configured");
  }
  const workspace = objectAt(config2?.workspace);
  if (workspace?.type === "ssh") {
    const ssh = objectAt(workspace.ssh);
    if (!nonEmptyString(ssh?.host) || !nonEmptyString(ssh?.user) || !nonEmptyString(ssh?.path)) {
      errors.push("ssh workspace requires host, user, and path");
    } else {
      lines.push("  ssh workspace config valid");
    }
  }
  if (workspace?.type === "docker") {
    const docker = objectAt(workspace.docker);
    if (!nonEmptyString(docker?.container) || !nonEmptyString(docker?.path)) {
      errors.push("docker workspace requires container and path");
    } else {
      lines.push("  docker workspace config valid");
    }
  }
  return { errors, warnings, lines };
}
function validateChainFile(path2, strict) {
  return validateNormalizedChain(readRawChainFile(path2).value, strict);
}
function runChainValidationCli(argv, write = (line) => console.log(line)) {
  const [path2, strictFlag] = argv;
  if (!path2) throw new Error("no chain file specified\n\nusage: mentiko validate <chain.json> [--strict]");
  const report = validateChainFile(path2, strictFlag === "--strict");
  if (report.errors.length > 0) throw new Error(report.errors.join("\n"));
  write(`validating ${path2}...`);
  report.lines.forEach(write);
  report.warnings.forEach(write);
  write("");
  write("validation complete");
}
if (require.main === module) {
  try {
    runChainValidationCli(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

// lib/runner-v2/chain-graph-cli.ts
function usage() {
  return "usage: mentiko graph <chain.json>";
}
function renderChainGraph(chainPath) {
  const raw = readRawChainFile(chainPath);
  const validation = validateNormalizedChain(raw.value, true);
  if (validation.errors.length > 0) throw new Error(validation.errors.join("\n"));
  const chain = normalizeChainDefinition(raw.value, config_default.agentsDir);
  validateNormalizedChainDefinition(chain);
  const name = typeof chain.name === "string" && chain.name.trim() ? chain.name : "unnamed";
  const agents = chain.agents;
  const lines = ["", `  chain: ${name}`, `  agents: ${agents.length}`, "  graph:", "  ---"];
  for (const agent of agents) {
    const id = typeof agent.id === "string" && agent.id ? agent.id : "unnamed";
    const agentName = typeof agent.name === "string" && agent.name ? agent.name : id;
    const triggers = Array.isArray(agent.triggers) ? agent.triggers.filter((value) => typeof value === "string") : [];
    const emits = typeof agent.emits === "string" ? agent.emits : "";
    lines.push(`  [${id}] ${agentName}`);
    lines.push(`    triggers: ${triggers.join(", ")}`);
    lines.push(`    emits:    ${emits}`);
    lines.push("");
  }
  return lines;
}
function runChainGraphCli(argv, write = (line) => console.log(line)) {
  if (argv.length !== 1 || !argv[0] || argv[0].startsWith("--")) throw new Error(usage());
  for (const line of renderChainGraph(argv[0])) write(line);
}
if (require.main === module) {
  try {
    runChainGraphCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  renderChainGraph,
  runChainGraphCli
});
